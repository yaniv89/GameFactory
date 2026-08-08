using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Forge.Api.Features.Billing;

/// <summary>
/// docs/SPEC.md Section 13.2/23.5: <c>POST /api/v1/workspaces/{ws}/billing/checkout-session</c>.
/// Only creates the Stripe Checkout Session and returns its URL — never
/// writes <see cref="Subscription"/> or <see cref="Workspace.Plan"/> here.
/// The session response the browser sees is not proof of payment
/// (CLAUDE.md Section 1.1 guardrail 4); <see cref="StripeWebhookEndpoint"/>
/// is the only place that writes plan/subscription state, and only from a
/// signature-verified event.
/// </summary>
public static class CheckoutSessionEndpoint
{
    public static IEndpointRouteBuilder MapCheckoutSession(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/billing/checkout-session", Handle)
            .RequireAuthorization("workspace:billing")
            .WithRateLimit("billing", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("CreateCheckoutSession")
            .Produces<CheckoutSessionResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        CheckoutSessionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IStripeBillingClient billing,
        IConfiguration configuration,
        CancellationToken ct)
    {
        if (req.Plan is not (WorkspacePlan.Pro or WorkspacePlan.Studio))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["plan"] = [$"Must be '{WorkspacePlan.Pro}' or '{WorkspacePlan.Studio}'."],
            });
        }

        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Id == workspaceId && w.DeletedAt == null, ct);
        if (workspace is null) return TypedResults.NotFound();

        if (workspace.Plan != WorkspacePlan.Free)
        {
            // Changing an existing subscription's plan is the Billing
            // Portal's job (docs/SPEC.md Section 13.2) — starting a new
            // Checkout session here would create a second, competing
            // subscription rather than modifying the first.
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["plan"] = ["This workspace already has a paid plan. Use the billing portal to change or cancel it."],
            });
        }

        var user = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == currentUser.UserId && u.DeletedAt == null, ct);
        if (user is null) return TypedResults.NotFound();

        var existingCustomerId = await db.Subscriptions
            .Where(s => s.WorkspaceId == workspaceId)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => (string?)s.StripeCustomerId)
            .FirstOrDefaultAsync(ct);

        var editorBaseUrl = configuration["Editor:BaseUrl"]
            ?? throw new InvalidOperationException("Missing Editor:BaseUrl configuration.");

        var result = await billing.CreateCheckoutSessionAsync(
            new CreateCheckoutSessionRequest(
                req.Plan,
                existingCustomerId,
                user.Email,
                workspaceId,
                SuccessUrl: $"{editorBaseUrl}/billing?checkout=success",
                CancelUrl: $"{editorBaseUrl}/billing?checkout=canceled"),
            ct);

        return TypedResults.Ok(new CheckoutSessionResponse(result.SessionUrl));
    }
}

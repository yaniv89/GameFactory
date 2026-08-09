using Forge.Api.RateLimiting;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Forge.Api.Features.Billing;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>POST /api/v1/workspaces/{ws}/billing/portal-session</c>
/// — plan change, cancel, invoices. The return URL is built server-side
/// from configuration, the same way <see cref="CheckoutSessionEndpoint"/>
/// builds its success/cancel URLs — accepting an arbitrary client-supplied
/// redirect target here would make this endpoint an open redirect via a
/// real Stripe-hosted page.
/// </summary>
public static class PortalSessionEndpoint
{
    public static IEndpointRouteBuilder MapPortalSession(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/billing/portal-session", Handle)
            .RequireAuthorization("workspace:billing")
            .WithRateLimit("billing", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("CreatePortalSession")
            .Produces<PortalSessionResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        ForgeDbContext db,
        IStripeBillingClient billing,
        IConfiguration configuration,
        CancellationToken ct)
    {
        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Id == workspaceId && w.DeletedAt == null, ct);
        if (workspace is null) return TypedResults.NotFound();

        var stripeCustomerId = await db.Subscriptions
            .Where(s => s.WorkspaceId == workspaceId)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => (string?)s.StripeCustomerId)
            .FirstOrDefaultAsync(ct);

        if (stripeCustomerId is null)
        {
            return TypedResults.Problem(
                title: "No billing history yet",
                detail: "This workspace has never checked out — there's nothing to manage in the billing portal yet.",
                statusCode: StatusCodes.Status404NotFound);
        }

        var editorBaseUrl = configuration["Editor:BaseUrl"]
            ?? throw new InvalidOperationException("Missing Editor:BaseUrl configuration.");

        var url = await billing.CreatePortalSessionAsync(stripeCustomerId, $"{editorBaseUrl}/billing", ct);
        return TypedResults.Ok(new PortalSessionResponse(url));
    }
}

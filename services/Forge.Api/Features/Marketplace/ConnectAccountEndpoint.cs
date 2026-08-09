using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// <c>POST /api/v1/authors/me/connect-account</c> — not one of
/// docs/SPEC.md Section 13.2's explicitly listed endpoints, but a
/// necessary addition: <see cref="Domain.Entities.User.StripeAccount"/>
/// (the destination a purchase's revenue share transfers to) cannot
/// exist without some way for an author to actually link one, and the
/// SPEC never names that endpoint. Scoped to the calling user as an
/// individual, not a workspace — same pattern <c>MeEndpoint</c> and
/// <c>PublishVersionEndpoint</c> already use for "the current user"
/// concerns that have no workspace in scope.
///
/// Always returns a fresh onboarding link, never a cached one — Stripe
/// account links expire and are single-use, so calling this again is
/// exactly how an author resumes an interrupted onboarding flow.
/// </summary>
public static class ConnectAccountEndpoint
{
    public static IEndpointRouteBuilder MapConnectAccount(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/authors/me/connect-account", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("CreateConnectAccountLink")
            .Produces<ConnectAccountLinkResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        ForgeDbContext db,
        ICurrentUser currentUser,
        IStripeMarketplaceClient marketplace,
        IConfiguration configuration,
        CancellationToken ct)
    {
        var user = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == currentUser.UserId && u.DeletedAt == null, ct);
        if (user is null) return TypedResults.NotFound();

        var editorBaseUrl = configuration["Editor:BaseUrl"]
            ?? throw new InvalidOperationException("Missing Editor:BaseUrl configuration.");

        var result = await marketplace.CreateConnectAccountLinkAsync(
            new CreateConnectAccountLinkRequest(
                user.StripeAccount,
                user.Email,
                RefreshUrl: $"{editorBaseUrl}/account/payouts?onboarding=refresh",
                ReturnUrl: $"{editorBaseUrl}/account/payouts?onboarding=return"),
            ct);

        // Recording the account id here, before onboarding actually
        // completes, mirrors how a Checkout Session's own id gets
        // recorded early elsewhere in this codebase — it's a real
        // Stripe-issued identifier either way, and a second call to this
        // endpoint (e.g. the author didn't finish onboarding) must reuse
        // the same account, not create a duplicate one.
        if (user.StripeAccount != result.StripeAccountId)
        {
            user.StripeAccount = result.StripeAccountId;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        return TypedResults.Ok(new ConnectAccountLinkResponse(result.OnboardingUrl));
    }
}

using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Play;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Play;

/// <summary>
/// docs/SPEC.md Section 17's "Player identity: anonymous by default,
/// optional account linking." <c>POST /api/v1/play/identity</c> is the
/// only Play Services endpoint that needs no authentication at all — it
/// creates the identity everything else authenticates as. Linking
/// (<c>POST /api/v1/play/identity/link</c>) requires the standard editor
/// Bearer token, not the play token being linked — the play token is
/// passed in the request body and its signature verified directly, the
/// same pattern <c>PurchaseCheckoutSessionEndpoint</c> uses for
/// resource ids that arrive somewhere a route-value policy can't see,
/// avoiding the need for two simultaneously-required authentication
/// schemes on one endpoint.
/// </summary>
public static class IdentityEndpoint
{
    public static IEndpointRouteBuilder MapIdentity(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/play/identity", HandleCreate)
            .WithRateLimit("play:identity", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.PlayIdentity)
            .WithName("CreatePlayIdentity")
            .Produces<PlayIdentityResponse>(StatusCodes.Status201Created);

        app.MapPost("/api/v1/play/identity/link", HandleLink)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("play:identity", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("LinkPlayIdentity")
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status204NoContent);

        return app;
    }

    private static async Task<IResult> HandleCreate(ForgeDbContext db, PlayTokenService tokenService, CancellationToken ct)
    {
        var player = new Player { CreatedAt = DateTimeOffset.UtcNow };
        db.Players.Add(player);
        await db.SaveChangesAsync(ct);

        return TypedResults.Created(
            "/api/v1/play/identity",
            new PlayIdentityResponse(player.Id, tokenService.Issue(player.Id)));
    }

    private static async Task<IResult> HandleLink(
        LinkPlayIdentityRequest req, ForgeDbContext db, PlayTokenService tokenService, ICurrentUser currentUser, CancellationToken ct)
    {
        if (!tokenService.TryValidate(req.PlayToken, out var playerId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["playToken"] = ["Invalid or expired play token."],
            });
        }

        var player = await db.Players.SingleOrDefaultAsync(p => p.Id == playerId, ct);
        if (player is null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["playToken"] = ["This play identity no longer exists."],
            });
        }

        player.LinkedUserId = currentUser.UserId;
        await db.SaveChangesAsync(ct);

        return TypedResults.NoContent();
    }
}

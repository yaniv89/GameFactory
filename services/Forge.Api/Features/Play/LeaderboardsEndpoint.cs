using System.Security.Claims;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Play;

namespace Forge.Api.Features.Play;

/// <summary>
/// docs/SPEC.md Section 17's leaderboards, read via the same
/// project-id-is-an-opaque-partition-key posture <c>SavesEndpoint</c>
/// documents. Reads are anonymous (any spectator can view a public
/// leaderboard, no play identity needed) and IP-keyed; submissions
/// require a play token and get their own tighter, player-keyed budget
/// (<see cref="RateLimitPolicies.LeaderboardSubmit"/>) — docs/SPEC.md's
/// own anti-cheat section names rate limiting as the first-line
/// mitigation, since "leaderboards from a browser game cannot be
/// trusted." <see cref="LeaderboardResponse.Verified"/> is hardcoded
/// <c>false</c> — see <see cref="LeaderboardStore"/>'s own doc comment
/// for why that's the honest answer, not a stub.
/// </summary>
public static class LeaderboardsEndpoint
{
    private const int DefaultLimit = 20;

    public static IEndpointRouteBuilder MapLeaderboards(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/play/{projectId:guid}/leaderboards/{leaderboardId}", HandleGet)
            .WithRateLimit("play:leaderboards:read", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Registry)
            .WithName("GetLeaderboard")
            .Produces<LeaderboardResponse>()
            .ProducesValidationProblem();

        app.MapPost("/api/v1/play/{projectId:guid}/leaderboards/{leaderboardId}/scores", HandleSubmit)
            .RequireAuthorization(ForgeAuthorizationExtensions.PlayTokenPolicy)
            .WithRateLimit("play:leaderboards:submit", RateLimitKeyStrategy.Player, RateLimitPolicies.LeaderboardSubmit)
            .WithName("SubmitLeaderboardScore")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();

        return app;
    }

    private static async Task<IResult> HandleGet(
        Guid projectId, string leaderboardId, int? limit, string? window, LeaderboardStore store, CancellationToken ct)
    {
        if (!PlayTableKeys.IsSafeId(leaderboardId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["leaderboardId"] = ["Must be 1-128 characters of letters, digits, '_', '.', or '-'."],
            });
        }

        // Windowed views (this-week / this-month) aren't implemented yet
        // — see LeaderboardStore's own doc comment. Rejecting anything
        // but the default rather than silently ignoring it keeps the gap
        // visible to the caller instead of quietly always returning
        // all-time results under a name that implies otherwise.
        if (window is not (null or "all"))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["window"] = ["Only 'all' is supported today — windowed leaderboards aren't implemented yet."],
            });
        }

        var boundedLimit = Math.Clamp(limit ?? DefaultLimit, 1, LeaderboardStore.MaxTopEntries);
        var entries = await store.GetTopAsync(projectId, leaderboardId, boundedLimit, ct);

        return TypedResults.Ok(new LeaderboardResponse(
            Verified: false,
            entries.Select(e => new LeaderboardEntryResponse(Guid.Parse(e.PlayerId), e.Score, e.SubmittedAt)).ToList()));
    }

    private static async Task<IResult> HandleSubmit(
        Guid projectId, string leaderboardId, SubmitScoreRequest req, ClaimsPrincipal user, LeaderboardStore store, CancellationToken ct)
    {
        if (!PlayTableKeys.IsSafeId(leaderboardId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["leaderboardId"] = ["Must be 1-128 characters of letters, digits, '_', '.', or '-'."],
            });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        await store.SubmitScoreAsync(projectId, leaderboardId, playerId, req.Score, ct);
        return TypedResults.NoContent();
    }
}

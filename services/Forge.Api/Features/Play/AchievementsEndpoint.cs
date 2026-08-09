using System.Security.Claims;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Play;

namespace Forge.Api.Features.Play;

/// <summary>
/// docs/SPEC.md Section 17's achievements. This MVP implements only the
/// client-asserted unlock path — see <see cref="AchievementStore"/>'s
/// own doc comment for why <see cref="AchievementUnlockResponse.Verified"/>
/// is always <c>false</c> — and unlocking is idempotent: calling it
/// twice for the same achievement id is a no-op, not an error, since a
/// game's own client logic re-asserting an unlock it already granted
/// (e.g. on every level-complete check) is the expected, normal case.
/// </summary>
public static class AchievementsEndpoint
{
    public static IEndpointRouteBuilder MapAchievements(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/play/{projectId:guid}/achievements")
            .RequireAuthorization(ForgeAuthorizationExtensions.PlayTokenPolicy)
            .WithRateLimit("play:achievements", RateLimitKeyStrategy.Player, RateLimitPolicies.Play);

        group.MapGet("", HandleList)
            .WithName("ListPlayerAchievements")
            .Produces<AchievementListResponse>();

        group.MapPost("/{achievementId}/unlock", HandleUnlock)
            .WithName("UnlockAchievement")
            .Produces<AchievementUnlockResponse>()
            .ProducesValidationProblem();

        return app;
    }

    private static async Task<IResult> HandleList(Guid projectId, ClaimsPrincipal user, AchievementStore store, CancellationToken ct)
    {
        var playerId = PlayClaimTypes.GetPlayerId(user);
        var unlocked = await store.ListUnlockedAsync(projectId, playerId, ct);

        return TypedResults.Ok(new AchievementListResponse(
            unlocked.Select(e => new AchievementUnlockResponse(e.RowKey, e.UnlockedAt, e.Verified)).ToList()));
    }

    private static async Task<IResult> HandleUnlock(
        Guid projectId, string achievementId, ClaimsPrincipal user, AchievementStore store, CancellationToken ct)
    {
        if (!PlayTableKeys.IsSafeId(achievementId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["achievementId"] = ["Must be 1-128 characters of letters, digits, '_', '.', or '-'."],
            });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        var entity = await store.UnlockAsync(projectId, playerId, achievementId, ct);

        return TypedResults.Ok(new AchievementUnlockResponse(entity.RowKey, entity.UnlockedAt, entity.Verified));
    }
}

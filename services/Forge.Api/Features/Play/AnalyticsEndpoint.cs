using System.Security.Claims;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Play;

namespace Forge.Api.Features.Play;

/// <summary>
/// docs/SPEC.md Section 17's analytics — ingestion only. See
/// <see cref="AnalyticsEventTableEntity"/>'s own doc comment for why the
/// daily Parquet rollup and any query/dashboard surface are a stated
/// follow-up, not built this phase.
/// </summary>
public static class AnalyticsEndpoint
{
    public static IEndpointRouteBuilder MapAnalytics(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/play/{projectId:guid}/analytics/events", HandleIngest)
            .RequireAuthorization(ForgeAuthorizationExtensions.PlayTokenPolicy)
            .WithRateLimit("play:analytics", RateLimitKeyStrategy.Player, RateLimitPolicies.Play)
            .WithName("IngestAnalyticsEvents")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();

        return app;
    }

    private static async Task<IResult> HandleIngest(
        Guid projectId, IngestAnalyticsEventsRequest req, ClaimsPrincipal user, AnalyticsEventStore store, CancellationToken ct)
    {
        if (req.Events.Count == 0 || req.Events.Count > AnalyticsEventStore.MaxEventsPerBatch)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["events"] = [$"Must submit between 1 and {AnalyticsEventStore.MaxEventsPerBatch} events per request."],
            });
        }
        if (req.Events.Any(e => string.IsNullOrWhiteSpace(e.EventType)))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["events"] = ["Every event needs a non-empty eventType."] });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        var events = req.Events.Select(e => (e.EventType, e.PayloadJson ?? "")).ToList();
        await store.IngestAsync(projectId, playerId, events, ct);

        return TypedResults.NoContent();
    }
}

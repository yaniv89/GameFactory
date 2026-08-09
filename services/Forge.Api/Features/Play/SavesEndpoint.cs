using System.Security.Claims;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Play;

namespace Forge.Api.Features.Play;

/// <summary>
/// docs/SPEC.md Section 17's cloud saves: 5 slots (0-4), 512 KB cap, and
/// last-write-wins with a conflict prompt — the ETag-based optimistic
/// concurrency <see cref="SaveSlotStore"/> implements. <c>projectId</c>
/// is never checked against the <c>Projects</c> table here: Play
/// Services data is Table-Storage-partitioned by
/// <c>{projectId}_{playerId}</c> regardless of whether that project id
/// corresponds to a row this API still tracks (docs/SPEC.md's file://
/// export, M6 Phase 5g's own exit criterion, means a published game can
/// run with zero network access at all — Play Services only matter for
/// the networked case, and there's no published-build tracking table
/// yet to validate against, "published_builds... still later scope" per
/// <c>ForgeDbContext</c>'s own doc comment). A save slot for an
/// unrecognized project id just lives in its own harmless partition,
/// never a cross-tenant read of anyone else's data.
/// </summary>
public static class SavesEndpoint
{
    /// <summary>docs/SPEC.md Section 17's own number — enforced here, not trusted from the client.</summary>
    private const int MaxSaveBytes = 512 * 1024;

    public static IEndpointRouteBuilder MapSaves(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/play/{projectId:guid}/saves")
            .RequireAuthorization(ForgeAuthorizationExtensions.PlayTokenPolicy)
            .WithRateLimit("play:saves", RateLimitKeyStrategy.Player, RateLimitPolicies.Play);

        group.MapGet("", HandleList)
            .WithName("ListSaveSlots")
            .Produces<SaveSlotListResponse>();

        group.MapGet("/{slot:int}", HandleGet)
            .WithName("GetSaveSlot")
            .Produces<SaveSlotResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesValidationProblem();

        group.MapPut("/{slot:int}", HandlePut)
            .WithName("PutSaveSlot")
            .Produces<SaveSlotResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapDelete("/{slot:int}", HandleDelete)
            .WithName("DeleteSaveSlot")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();

        return app;
    }

    private static bool IsValidSlot(int slot) => slot is >= 0 and < SaveSlotStore.SlotCount;

    private static async Task<IResult> HandleList(Guid projectId, ClaimsPrincipal user, SaveSlotStore store, CancellationToken ct)
    {
        var playerId = PlayClaimTypes.GetPlayerId(user);
        var existing = await store.ListSlotsAsync(projectId, playerId, ct);
        var byRowKey = existing.ToDictionary(e => e.RowKey);

        var slots = Enumerable.Range(0, SaveSlotStore.SlotCount)
            .Select(slot => byRowKey.TryGetValue(slot.ToString(), out var entity)
                ? new SaveSlotResponse(slot, entity.DataBase64, entity.UpdatedAt, entity.ETag.ToString())
                : new SaveSlotResponse(slot, null, null, null))
            .ToList();

        return TypedResults.Ok(new SaveSlotListResponse(slots));
    }

    private static async Task<IResult> HandleGet(Guid projectId, int slot, ClaimsPrincipal user, SaveSlotStore store, CancellationToken ct)
    {
        if (!IsValidSlot(slot))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["slot"] = [$"Must be 0-{SaveSlotStore.SlotCount - 1}."] });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        var entity = await store.GetSlotAsync(projectId, playerId, slot, ct);
        if (entity is null) return TypedResults.NotFound();

        return TypedResults.Ok(new SaveSlotResponse(slot, entity.DataBase64, entity.UpdatedAt, entity.ETag.ToString()));
    }

    private static async Task<IResult> HandlePut(
        Guid projectId, int slot, PutSaveSlotRequest req, ClaimsPrincipal user, SaveSlotStore store, CancellationToken ct)
    {
        if (!IsValidSlot(slot))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["slot"] = [$"Must be 0-{SaveSlotStore.SlotCount - 1}."] });
        }

        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(req.DataBase64);
        }
        catch (FormatException)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["dataBase64"] = ["Not valid base64."] });
        }
        if (decoded.Length > MaxSaveBytes)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["dataBase64"] = [$"Save data is {decoded.Length} bytes. Limit is {MaxSaveBytes}."],
            });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        var result = await store.PutSlotAsync(projectId, playerId, slot, req.DataBase64, req.ExpectedETag, ct);

        if (result.Outcome == PutSlotOutcome.Conflict)
        {
            return TypedResults.Problem(
                title: "Save conflict",
                detail: "This slot was updated by another session since you last read it. Fetch the current save and decide which to keep.",
                statusCode: StatusCodes.Status409Conflict,
                extensions: new Dictionary<string, object?>
                {
                    ["current"] = new SaveSlotResponse(slot, result.Current!.DataBase64, result.Current.UpdatedAt, result.Current.ETag.ToString()),
                });
        }

        var updated = await store.GetSlotAsync(projectId, playerId, slot, ct);
        return TypedResults.Ok(new SaveSlotResponse(slot, updated!.DataBase64, updated.UpdatedAt, updated.ETag.ToString()));
    }

    private static async Task<IResult> HandleDelete(Guid projectId, int slot, ClaimsPrincipal user, SaveSlotStore store, CancellationToken ct)
    {
        if (!IsValidSlot(slot))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["slot"] = [$"Must be 0-{SaveSlotStore.SlotCount - 1}."] });
        }

        var playerId = PlayClaimTypes.GetPlayerId(user);
        await store.DeleteSlotAsync(projectId, playerId, slot, ct);
        return TypedResults.NoContent();
    }
}

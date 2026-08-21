using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.ArtGeneration;

/// <summary>
/// docs/adr/0016 Decision 2/6: <c>POST /api/v1/workspaces/{ws}/projects/{p}/art-generation</c>.
/// The synchronous half of the pipeline — expands the creator's free-text
/// description into a real generation prompt via <see cref="IArtGenerationClient.ExpandPromptAsync"/>
/// and returns it for a quick look before any image-generation cost is
/// spent. Writes exactly one row, already resolved to a terminal-for-this-
/// step status (<see cref="GenerationStatus.AwaitingConfirmation"/>,
/// <see cref="GenerationStatus.Declined"/>, or <see cref="GenerationStatus.Failed"/>)
/// — there is no persisted "in flight" state for this call, since nothing
/// else can observe it mid-request.
/// </summary>
public static class CreateGenerationRequestEndpoint
{
    private static readonly IReadOnlySet<string> ValidCategories = new HashSet<string>(StringComparer.Ordinal)
    {
        ArtGenCategory.Tile, ArtGenCategory.Prop,
    };

    // docs/adr/0016 Decision 6 / N6: a live COUNT, not a cached counter
    // (CLAUDE.md Section 1.5 guardrail 18) — the second, independent
    // control on real per-call external cost, alongside
    // RateLimitPolicies.ArtGeneration's own burst-rate limit. Tiered by
    // plan rather than one flat number every Pro+ workspace shared —
    // docs/SPEC.md Section 23.2's own Pro-vs-Studio scaling for the
    // sibling "wizard generations" capability (100/month vs 500/month,
    // a 5x spread for the higher-priced tier) is the closest grounded
    // precedent this codebase has for how those two tiers should differ
    // on an AI-generation cost guardrail specifically, rather than
    // picking a second number arbitrarily. Same caveat docs/adr/0016's
    // own original flat constant already carried: a launch default to
    // re-cut once real usage exists for *this* feature, not a number
    // derived from usage data that doesn't exist yet.
    private static readonly IReadOnlyDictionary<string, int> DailyBudgetByPlan = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        [WorkspacePlan.Pro] = 20,
        [WorkspacePlan.Studio] = 100,
    };

    // The tightest tier's own number -- reached only if a workspace's
    // plan is somehow neither Pro nor Studio despite already passing the
    // workspace:pro authorization gate (defensive, not an expected path:
    // this handler makes no assumption that a different layer's check
    // already ran, CLAUDE.md guardrail 4's spirit applied to this read
    // too).
    private static readonly int FallbackDailyBudget = DailyBudgetByPlan[WorkspacePlan.Pro];

    public static IEndpointRouteBuilder MapCreateGenerationRequest(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/projects/{projectId:guid}/art-generation", Handle)
            // docs/adr/0016 Decision 6: generation is Pro/Studio only in
            // v1 — the same combined-policy pattern CreateBuildEndpoint
            // established (role failure masks plan-gate failure via
            // WorkspaceAuthorizationMiddlewareResultHandler, so a
            // non-member still gets 404, never a plan-upgrade prompt that
            // discloses the project exists).
            .RequireAuthorization("workspace:write", "workspace:pro")
            .WithRateLimit("art-generation", RateLimitKeyStrategy.User, RateLimitPolicies.ArtGeneration)
            .WithName("CreateGenerationRequest")
            .Produces<GenerationRequestResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status402PaymentRequired)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        Guid projectId,
        CreateGenerationRequestRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IArtGenerationClient artGeneration,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.UserPrompt))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["userPrompt"] = ["Required."] });
        }
        if (req.UserPrompt.Length > 500)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["userPrompt"] = ["Must be 500 characters or fewer."] });
        }
        if (!ValidCategories.Contains(req.Category))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["category"] = [$"Must be one of: {string.Join(", ", ValidCategories)}."],
            });
        }

        // Same cross-tenant-404 spirit as UploadAssetEndpoint's own
        // project-vs-workspace check: a projectId from a different
        // workspace (or one that doesn't exist) is indistinguishable from
        // "not found," never disclosed via a different response shape.
        // Pulls the workspace's own Plan in the same query (N6) rather
        // than a second round trip — workspace:pro authorization already
        // guarantees this project's workspace passed the plan gate, so
        // this is reading the same fact the middleware already checked,
        // not re-deciding whether the request is even allowed.
        var project = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => new { p.WorkspaceId, WorkspacePlan = p.Workspace!.Plan })
            .SingleOrDefaultAsync(ct);
        if (project is null || project.WorkspaceId != workspaceId)
        {
            return TypedResults.NotFound();
        }

        var dailyBudget = DailyBudgetByPlan.GetValueOrDefault(project.WorkspacePlan, FallbackDailyBudget);
        var todayStart = DateTimeOffset.UtcNow.Date;
        var usedToday = await db.GenerationRequests
            .Where(g => g.WorkspaceId == workspaceId
                && g.CreatedAt >= todayStart
                && g.Status != GenerationStatus.Failed
                && g.Status != GenerationStatus.Declined)
            .CountAsync(ct);
        if (usedToday >= dailyBudget)
        {
            return TypedResults.Problem(
                title: "Daily generation limit reached",
                detail: $"This workspace has used {usedToday} of {dailyBudget} art generations today. The limit resets at midnight UTC.",
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        // docs/adr/0016 Decision 5: the active pack's own style as a
        // steering hint is real, named follow-on work (requires resolving
        // the project's ProjectDocument.activePack manifest) — not
        // attempted here. Passing null keeps the expansion call correct
        // today rather than half-wiring a hint that's silently always
        // absent.
        var request = new GenerationRequest
        {
            Id = Guid.NewGuid(),
            WorkspaceId = workspaceId,
            ProjectId = projectId,
            UserPrompt = req.UserPrompt,
            Category = req.Category,
            RequestedByUserId = currentUser.UserId,
            CreatedAt = DateTimeOffset.UtcNow,
            Status = GenerationStatus.Failed, // overwritten below on either real outcome
        };
        try
        {
            var expansion = await artGeneration.ExpandPromptAsync(
                new ExpandPromptRequest(req.UserPrompt, req.Category, ActivePackStyleHint: null),
                ct);

            request.Status = expansion.Declined ? GenerationStatus.Declined : GenerationStatus.AwaitingConfirmation;
            request.ExpandedPrompt = expansion.Declined ? null : expansion.ExpandedPrompt;
            request.ErrorMessage = expansion.Declined
                ? (expansion.DeclineReason ?? "The description couldn't be expanded into a generation prompt. Try rephrasing it.")
                : null;
        }
        catch (HttpRequestException)
        {
            // A genuine harness failure (network error, Gemini outage, a
            // non-2xx status EnsureSuccessStatusCode surfaced) — distinct
            // from Declined per GenerationStatus's own doc comment. Still
            // written as a real row (CLAUDE.md guardrail 11: never
            // silently swallow) rather than a bare 5xx with no record of
            // the attempt, matching Asset/Build's own "the log only ever
            // grows" pattern for their async Failed state. request.Status
            // is already Failed from initialization above.
            request.ErrorMessage = "The art-generation service didn't respond. Try again in a moment.";
        }
        db.GenerationRequests.Add(request);
        await db.SaveChangesAsync(ct);

        return TypedResults.Created(
            $"/api/v1/workspaces/{workspaceId}/projects/{projectId}/art-generation/{request.Id}",
            new GenerationRequestResponse(request.Id, request.Category, request.Status, request.ExpandedPrompt, request.ErrorMessage, request.CreatedAt, Variations: []));
    }
}

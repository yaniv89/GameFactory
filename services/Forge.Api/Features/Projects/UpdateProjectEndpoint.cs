using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>PATCH /api/v1/projects/{id}</c>. Slug and
/// engine version are deliberately not patchable here — slug changes
/// would break stable URLs and exports, and engine version is meant to
/// advance via the build/upgrade path (M6), not a metadata edit.
/// </summary>
public static class UpdateProjectEndpoint
{
    public static IEndpointRouteBuilder MapUpdateProject(this IEndpointRouteBuilder app)
    {
        app.MapPatch("/api/v1/projects/{projectId:guid}", Handle)
            .RequireAuthorization("project:write")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("UpdateProject")
            .Produces<ProjectDetailResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, UpdateProjectRequest req, ForgeDbContext db, CancellationToken ct)
    {
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId && p.DeletedAt == null, ct);
        if (project is null) return TypedResults.NotFound();

        if (req.Visibility is not null
            && req.Visibility != ProjectVisibility.Private
            && req.Visibility != ProjectVisibility.Unlisted
            && req.Visibility != ProjectVisibility.Public)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["visibility"] = [$"Must be one of: {ProjectVisibility.Private}, {ProjectVisibility.Unlisted}, {ProjectVisibility.Public}."],
            });
        }

        if (req.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Title))
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["title"] = ["Cannot be blank."] });
            }
            project.Title = req.Title;
        }
        if (req.Description is not null) project.Description = req.Description;
        if (req.Visibility is not null) project.Visibility = req.Visibility;
        if (req.CoverAssetId is not null) project.CoverAssetId = req.CoverAssetId;
        project.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(CreateProjectEndpoint.ToDetail(project));
    }
}

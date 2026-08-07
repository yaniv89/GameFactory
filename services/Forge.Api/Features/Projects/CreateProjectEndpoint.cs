using System.Text.RegularExpressions;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Forge.Api.Features.Projects;

/// <summary>docs/SPEC.md Section 13.2: <c>POST /api/v1/workspaces/{ws}/projects</c>.</summary>
public static class CreateProjectEndpoint
{
    private static readonly Regex SlugPattern = new("^[a-z0-9]+(-[a-z0-9]+)*$", RegexOptions.Compiled);

    public static IEndpointRouteBuilder MapCreateProject(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/projects", Handle)
            .RequireAuthorization("workspace:write")
            .WithName("CreateProject")
            .Produces<ProjectDetailResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        CreateProjectRequest req,
        ForgeDbContext db,
        CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Slug) || !SlugPattern.IsMatch(req.Slug))
        {
            errors["slug"] = ["Must be lowercase letters, numbers, and hyphens, with no leading, trailing, or repeated hyphens."];
        }
        if (string.IsNullOrWhiteSpace(req.Title))
        {
            errors["title"] = ["Required."];
        }
        if (string.IsNullOrWhiteSpace(req.EngineVersion))
        {
            errors["engineVersion"] = ["Required."];
        }
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var project = new Project
        {
            WorkspaceId = workspaceId,
            Slug = req.Slug,
            Title = req.Title,
            Description = req.Description,
            EngineVersion = req.EngineVersion,
            GenreTemplate = string.IsNullOrWhiteSpace(req.GenreTemplate) ? "topdown-rpg" : req.GenreTemplate,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Projects.Add(project);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent request created the same slug in this workspace
            // first — the unique index (workspace_id, slug) is the real
            // guard; this just turns its violation into a clean 409
            // instead of a raw 500.
            return TypedResults.Problem(
                title: "Slug already in use",
                detail: $"A project with slug '{req.Slug}' already exists in this workspace.",
                statusCode: StatusCodes.Status409Conflict);
        }

        return TypedResults.Created($"/api/v1/projects/{project.Id}", ToDetail(project));
    }

    internal static ProjectDetailResponse ToDetail(Project p) => new(
        p.Id, p.WorkspaceId, p.Slug, p.Title, p.Description, p.GenreTemplate,
        p.EngineVersion, p.Visibility, p.HeadRevision, p.CoverAssetId, p.CreatedAt, p.UpdatedAt);
}

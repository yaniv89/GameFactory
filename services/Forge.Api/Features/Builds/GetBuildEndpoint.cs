using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Builds;

/// <summary>
/// docs/adr/0010 Decision 3: <c>GET /api/v1/projects/{id}/builds/{buildId}</c> —
/// the endpoint a client polls after <see cref="CreateBuildEndpoint"/>
/// until <see cref="BuildStatusResponse.Status"/> reaches
/// <see cref="BuildStatus.Ready"/> or <see cref="BuildStatus.Failed"/>.
/// </summary>
public static class GetBuildEndpoint
{
    public static IEndpointRouteBuilder MapGetBuild(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/builds/{buildId:guid}", Handle)
            .RequireAuthorization("project:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetBuild")
            .Produces<BuildStatusResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, Guid buildId, ForgeDbContext db, IConfiguration configuration, CancellationToken ct)
    {
        var build = await db.Builds
            .Where(b => b.Id == buildId && b.ProjectId == projectId)
            .SingleOrDefaultAsync(ct);
        if (build is null) return TypedResults.NotFound();

        string? playUrl = null;
        if (build.Status == BuildStatus.Ready)
        {
            // Same IConfiguration["..."] pattern CheckoutSessionEndpoint
            // already uses for Editor:BaseUrl — Forge.Play (C4) is a
            // genuinely separate origin/deployment, not something this
            // process ever calls into, so a configured base URL is the
            // right join here, not a service reference.
            var playBaseUrl = configuration["Play:BaseUrl"]
                ?? throw new InvalidOperationException("Play:BaseUrl is not configured.");
            playUrl = $"{playBaseUrl}/{build.Id}/";
        }

        return TypedResults.Ok(new BuildStatusResponse(
            build.Id, build.RevisionId, build.Status, playUrl, build.ErrorMessage, build.SizeBytes, build.CreatedAt, build.CompletedAt));
    }
}

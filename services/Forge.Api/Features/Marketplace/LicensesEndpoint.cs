using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/workspaces/{ws}/licenses</c>.
/// <c>workspaceId</c> is a real route value here (unlike the checkout
/// endpoint), so it goes through the same <c>workspace:read</c>
/// route-value policy every other workspace-scoped read endpoint uses —
/// no inline authorization needed.
/// </summary>
public static class LicensesEndpoint
{
    public static IEndpointRouteBuilder MapLicenses(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/licenses", Handle)
            .RequireAuthorization("workspace:read")
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetWorkspaceLicenses")
            .Produces<IReadOnlyList<LicenseResponse>>();
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, ForgeDbContext db, CancellationToken ct)
    {
        var licenses = await db.Licenses
            .Where(l => l.WorkspaceId == workspaceId && l.RevokedAt == null)
            .OrderByDescending(l => l.GrantedAt)
            .Select(l => new LicenseResponse(l.Id, l.Package!.Name, l.GrantedVia, l.GrantedAt, l.ExpiresAt))
            .ToListAsync(ct);

        return TypedResults.Ok(licenses);
    }
}

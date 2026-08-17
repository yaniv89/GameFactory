using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Authorization;

/// <summary>
/// Shared by every <see cref="WorkspaceResourceKind"/>-based authorization
/// handler (<see cref="WorkspaceRoleHandler"/>, <see cref="PlanGateHandler"/>):
/// resolves the route value named by <paramref name="routeParameterName"/>
/// to the workspace that owns it, either directly (the value already is a
/// workspace id) or via a lookup (the value is some other resource's id).
/// </summary>
internal static class WorkspaceResolver
{
    public static async Task<Guid?> ResolveWorkspaceIdAsync(
        ForgeDbContext db,
        HttpContext httpContext,
        WorkspaceResourceKind resourceKind,
        string routeParameterName,
        CancellationToken ct)
    {
        var routeValue = httpContext.GetRouteValue(routeParameterName)?.ToString();
        if (!Guid.TryParse(routeValue, out var resourceId)) return null;

        return resourceKind switch
        {
            WorkspaceResourceKind.Workspace => resourceId,
            WorkspaceResourceKind.Project => await db.Projects
                .Where(p => p.Id == resourceId && p.DeletedAt == null)
                .Select(p => (Guid?)p.WorkspaceId)
                .SingleOrDefaultAsync(ct),
            // docs/adr/0012: DeleteAssetEndpoint's route carries an
            // assetId, not a workspaceId — resolved the same lookup shape
            // as Project above. Deliberately excludes an already-deleted
            // asset (DeletedAt != null) so a second DELETE on the same id
            // 404s instead of re-succeeding, the same "no re-triggering a
            // one-shot terminal state" reasoning WorkspaceRoleHandler's
            // callers already rely on elsewhere.
            WorkspaceResourceKind.Asset => await db.Assets
                .Where(a => a.Id == resourceId && a.DeletedAt == null)
                .Select(a => (Guid?)a.WorkspaceId)
                .SingleOrDefaultAsync(ct),
            _ => null,
        };
    }
}

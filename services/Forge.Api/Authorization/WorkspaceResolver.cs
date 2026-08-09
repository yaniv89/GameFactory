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
            _ => null,
        };
    }
}

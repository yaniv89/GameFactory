using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Forge.Api.Authorization;

/// <summary>
/// Resolves a <see cref="WorkspaceRoleRequirement"/> against the real
/// database — the route value names a resource, the resource's
/// workspace is looked up, and the current user's own membership row on
/// that workspace (never a client-supplied role) decides the outcome.
///
/// Deliberately does not distinguish "resource doesn't exist" from
/// "resource exists but you have no access to it" — both just fail the
/// requirement. <see cref="NotFoundOnForbidAuthorizationMiddlewareResultHandler"/>
/// turns that failure into 404, not 403, which is what actually
/// enforces docs/SPEC.md Section 4.5's "cross-tenant access returns 404,
/// never 403": a 403 would itself leak that the resource exists.
/// </summary>
public sealed class WorkspaceRoleHandler(ForgeDbContext db) : AuthorizationHandler<WorkspaceRoleRequirement>
{
    private static readonly IReadOnlyDictionary<string, int> RoleRank = new Dictionary<string, int>
    {
        [WorkspaceRole.Viewer] = 0,
        [WorkspaceRole.Editor] = 1,
        [WorkspaceRole.Admin] = 2,
        [WorkspaceRole.Owner] = 3,
    };

    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, WorkspaceRoleRequirement requirement)
    {
        if (context.Resource is not HttpContext httpContext) return;

        var currentUser = httpContext.RequestServices.GetRequiredService<ICurrentUser>();
        if (!currentUser.IsAuthenticated) return;

        var routeValue = httpContext.GetRouteValue(requirement.RouteParameterName)?.ToString();
        if (!Guid.TryParse(routeValue, out var resourceId)) return;

        var ct = httpContext.RequestAborted;
        Guid? workspaceId = requirement.ResourceKind switch
        {
            WorkspaceResourceKind.Workspace => resourceId,
            WorkspaceResourceKind.Project => await db.Projects
                .Where(p => p.Id == resourceId && p.DeletedAt == null)
                .Select(p => (Guid?)p.WorkspaceId)
                .SingleOrDefaultAsync(ct),
            _ => null,
        };
        if (workspaceId is not { } resolvedWorkspaceId) return;

        var role = await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == resolvedWorkspaceId && m.UserId == currentUser.UserId)
            .Select(m => m.Role)
            .SingleOrDefaultAsync(ct);

        if (role is not null
            && RoleRank.TryGetValue(role, out var actualRank)
            && RoleRank.TryGetValue(requirement.MinimumRole, out var requiredRank)
            && actualRank >= requiredRank)
        {
            context.Succeed(requirement);
        }
    }
}

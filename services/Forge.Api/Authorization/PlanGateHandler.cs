using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Authorization;

/// <summary>
/// Resolves a <see cref="PlanGateRequirement"/> against the real
/// <see cref="Workspace.Plan"/> column. Unlike <see cref="WorkspaceRoleHandler"/>
/// this doesn't need the caller's identity at all — plan is a property of
/// the workspace, not of who's asking — so there's no
/// <c>ICurrentUser</c>/claims dependency to get the ordering of wrong.
///
/// A failed requirement here means "this workspace needs to upgrade",
/// which is a materially different situation from
/// <see cref="WorkspaceRoleRequirement"/>'s "you don't have access to
/// this" — <see cref="WorkspaceAuthorizationMiddlewareResultHandler"/>
/// answers each with a different status code (402 vs 404) for exactly
/// that reason.
/// </summary>
public sealed class PlanGateHandler(ForgeDbContext db) : AuthorizationHandler<PlanGateRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PlanGateRequirement requirement)
    {
        if (context.Resource is not HttpContext httpContext) return;

        var ct = httpContext.RequestAborted;
        var workspaceId = await WorkspaceResolver.ResolveWorkspaceIdAsync(db, httpContext, requirement.ResourceKind, requirement.RouteParameterName, ct);
        if (workspaceId is not { } resolvedWorkspaceId) return;

        var plan = await db.Workspaces
            .Where(w => w.Id == resolvedWorkspaceId && w.DeletedAt == null)
            .Select(w => w.Plan)
            .SingleOrDefaultAsync(ct);

        if (plan is not null && WorkspacePlan.GatesOpen.Contains(plan))
        {
            context.Succeed(requirement);
        }
    }
}

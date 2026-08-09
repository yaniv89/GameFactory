using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Forge.Api.Authorization;

/// <summary>
/// Resolves a <see cref="WorkspaceRoleRequirement"/> against the real
/// database — the route value names a resource, the resource's
/// workspace is looked up, and the current user's own membership row on
/// that workspace (never a client-supplied role) decides the outcome.
///
/// Resolves the domain user directly from <see cref="AuthorizationHandlerContext.User"/>'s
/// Subject claim, the same lookup <see cref="CurrentUserMiddleware"/> does
/// — deliberately NOT via <see cref="ICurrentUser"/>. A real CI run
/// caught why: this handler runs as part of the authorization middleware
/// itself, which executes before <c>CurrentUserMiddleware</c> (placed
/// after <c>UseAuthorization()</c> so it can see a policy's own
/// scheme-specific re-authenticated <c>HttpContext.User</c>). Reading
/// <see cref="ICurrentUser"/> here always saw <c>IsAuthenticated == false</c>
/// and every <see cref="WorkspaceRoleRequirement"/>-gated request 404'd —
/// invisible in Phase 2's unit tests, which called this handler directly
/// with a hand-built <c>ICurrentUser</c> rather than through the real
/// pipeline. <c>context.User</c>, unlike <c>ICurrentUser</c>, is exactly
/// that policy's own re-authenticated principal, already correct by the
/// time this handler runs.
///
/// Deliberately does not distinguish "resource doesn't exist" from
/// "resource exists but you have no access to it" — both just fail the
/// requirement. <see cref="WorkspaceAuthorizationMiddlewareResultHandler"/>
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

        var subjectClaim = context.User.FindFirst(OpenIddictConstants.Claims.Subject)?.Value;
        if (subjectClaim is null) return;

        var ct = httpContext.RequestAborted;
        var workspaceId = await WorkspaceResolver.ResolveWorkspaceIdAsync(db, httpContext, requirement.ResourceKind, requirement.RouteParameterName, ct);
        if (workspaceId is not { } resolvedWorkspaceId) return;

        var userId = await db.DomainUsers
            .Where(u => u.IdentitySubjectId == subjectClaim && u.DeletedAt == null)
            .Select(u => (Guid?)u.Id)
            .SingleOrDefaultAsync(ct);
        if (userId is null) return;

        var role = await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == resolvedWorkspaceId && m.UserId == userId)
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

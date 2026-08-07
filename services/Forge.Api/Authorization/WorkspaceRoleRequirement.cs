using Microsoft.AspNetCore.Authorization;

namespace Forge.Api.Authorization;

/// <summary>What kind of resource the route parameter identifies — the requirement resolves it to a workspace either directly or via a lookup.</summary>
public enum WorkspaceResourceKind
{
    Workspace,
    Project,
}

/// <summary>
/// "The caller must hold at least <paramref name="minimumRole"/> on the
/// workspace that owns the resource named by
/// <paramref name="routeParameterName"/>." Resolved server-side from the
/// route value and the authenticated user's own membership row — never
/// from anything the client asserts about its own access (CLAUDE.md
/// Section 1.1 guardrail 4).
/// </summary>
public sealed class WorkspaceRoleRequirement(string minimumRole, WorkspaceResourceKind resourceKind, string routeParameterName) : IAuthorizationRequirement
{
    public string MinimumRole { get; } = minimumRole;

    public WorkspaceResourceKind ResourceKind { get; } = resourceKind;

    public string RouteParameterName { get; } = routeParameterName;
}

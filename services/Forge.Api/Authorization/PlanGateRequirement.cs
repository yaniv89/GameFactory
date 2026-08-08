using Microsoft.AspNetCore.Authorization;

namespace Forge.Api.Authorization;

/// <summary>
/// "The workspace that owns the resource named by
/// <paramref name="routeParameterName"/> must currently be on a paid
/// plan" (docs/SPEC.md Section 23.2/23.5 — the export/publish wall).
/// Resolved server-side from <see cref="Domain.Entities.Workspace.Plan"/>,
/// itself written only by verified Stripe webhook events, never from
/// anything a client asserts (CLAUDE.md Section 1.1 guardrail 4).
///
/// Registered (see <see cref="ForgeAuthorizationExtensions"/>) but not
/// yet attached to any M5 endpoint: the first real consumer is M6's
/// export/publish endpoint. Same "built ahead of its first caller"
/// pattern <c>project:read</c>/<c>project:write</c> followed in M5 Phase
/// 2, consumed starting Phase 3.
/// </summary>
public sealed class PlanGateRequirement(WorkspaceResourceKind resourceKind, string routeParameterName) : IAuthorizationRequirement
{
    public WorkspaceResourceKind ResourceKind { get; } = resourceKind;

    public string RouteParameterName { get; } = routeParameterName;
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace Forge.Api.Authorization;

/// <summary>
/// Custom failure responses for the two workspace-scoped requirement
/// types, replacing ASP.NET Core's default 403/401 (every other policy
/// keeps the framework default):
///
/// - <see cref="WorkspaceRoleRequirement"/> failures return 404
///   (docs/SPEC.md Section 4.5: "cross-tenant access returns 404, never
///   403" — a 403 would itself disclose that the resource exists in some
///   workspace the caller can't see).
/// - <see cref="PlanGateRequirement"/> failures return 402 (docs/SPEC.md
///   Section 23.2: export/publish on a Free-tier workspace is a real,
///   named "upgrade" state, not an access violation — the caller can see
///   and edit the resource fine, they just can't do this one gated
///   action yet).
///
/// Named for what it does (workspace-scoped authorization outcomes), not
/// "NotFoundOnForbid" as an earlier version was — that name stopped being
/// accurate the moment this handler grew a second, non-404 outcome.
///
/// docs/adr/0010's build-creation endpoint is the first caller to combine
/// two named policies on one endpoint (<c>project:write</c> AND
/// <c>project:pro</c> — see <c>CreateBuildEndpoint</c>). ASP.NET Core
/// merges combined policies into a single <see cref="AuthorizationPolicy"/>
/// carrying every requirement from both before this handler ever runs, so
/// <c>policy.Requirements</c> alone can't tell which requirement(s)
/// actually failed versus merely being present in the merged policy — a
/// caller who fails only <see cref="WorkspaceRoleRequirement"/> (not a
/// project member at all) would otherwise also match
/// <c>policy.Requirements.OfType&lt;PlanGateRequirement&gt;().Any()</c>
/// purely because that requirement type is present in the combined
/// policy, producing a 402 "upgrade required" — which both leaks that the
/// project exists and is gated, and is simply the wrong answer for "you
/// have no access here at all." <see cref="PolicyAuthorizationResult.AuthorizationFailure"/>'s
/// <c>FailedRequirements</c> is the real, per-requirement signal
/// (populated by the framework's own authorization service with exactly
/// the requirements that never got <c>context.Succeed()</c> called,
/// however many named policies were combined to build this one) — this
/// checks that first, falling back to <c>policy.Requirements</c> only if
/// it's unavailable (single-policy case, unchanged from before). Role
/// failure is checked before plan-gate failure so a non-member's 404
/// masks a plan-gate failure it should never see.
/// </summary>
public sealed class WorkspaceAuthorizationMiddlewareResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (!authorizeResult.Succeeded)
        {
            var failedRequirements = authorizeResult.AuthorizationFailure?.FailedRequirements ?? policy.Requirements;

            if (failedRequirements.OfType<WorkspaceRoleRequirement>().Any())
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                context.Response.ContentType = "application/problem+json";
                await context.Response.WriteAsJsonAsync(new { title = "Not Found", status = StatusCodes.Status404NotFound });
                return;
            }

            if (failedRequirements.OfType<PlanGateRequirement>().Any())
            {
                context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
                context.Response.ContentType = "application/problem+json";
                await context.Response.WriteAsJsonAsync(new
                {
                    title = "Upgrade required",
                    detail = "This action requires a Pro or Studio plan. Upgrade your workspace to continue.",
                    status = StatusCodes.Status402PaymentRequired,
                });
                return;
            }
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}

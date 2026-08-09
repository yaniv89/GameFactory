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
            if (policy.Requirements.OfType<PlanGateRequirement>().Any())
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

            if (policy.Requirements.OfType<WorkspaceRoleRequirement>().Any())
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                context.Response.ContentType = "application/problem+json";
                await context.Response.WriteAsJsonAsync(new { title = "Not Found", status = StatusCodes.Status404NotFound });
                return;
            }
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}

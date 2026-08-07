using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace Forge.Api.Authorization;

/// <summary>
/// docs/SPEC.md Section 4.5: "Cross-tenant access returns 404, never
/// 403." ASP.NET Core's default authorization result handler returns 403
/// (or 401) on failure, which — for a workspace-scoped policy — would
/// itself disclose that the resource exists in some workspace the
/// caller can't see. Any policy built from
/// <see cref="WorkspaceRoleRequirement"/> gets 404 instead; every other
/// policy keeps the framework default.
/// </summary>
public sealed class NotFoundOnForbidAuthorizationMiddlewareResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (!authorizeResult.Succeeded && policy.Requirements.OfType<WorkspaceRoleRequirement>().Any())
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new { title = "Not Found", status = 404 });
            return;
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}

using Forge.Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using OpenIddict.Validation.AspNetCore;

namespace Forge.Api.Authorization;

// Not AuthorizationServiceCollectionExtensions: that exact name already
// exists in Microsoft.Extensions.DependencyInjection (a real, built-in
// ASP.NET Core class providing AddAuthorization(...)), which
// Microsoft.NET.Sdk.Web's implicit global usings pull into every file in
// this project — an identically-named class here is ambiguous at every
// call site, not just a style clash.
public static class ForgeAuthorizationExtensions
{
    /// <summary>Every resource API endpoint (as opposed to /connect/authorize, which needs the Identity cookie scheme specifically) authenticates via the OpenIddict-issued Bearer access token.</summary>
    public const string BearerPolicy = "Bearer";

    /// <summary>
    /// Wires <see cref="ICurrentUser"/>, the workspace-role requirement
    /// handler, the 403-to-404 result handler, and the policies. Every
    /// policy here explicitly binds to
    /// <see cref="OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme"/> —
    /// leaving that unstated would fall back to the default authentication
    /// scheme, which after <c>AddIdentity()</c> is the cookie scheme, and
    /// a Bearer-token API call carries no cookie at all.
    ///
    /// <c>project:read</c>/<c>project:write</c> are the real, final policy
    /// names M5 Phase 3's CommitRevision endpoint (docs/SPEC.md Section
    /// 13.3) is written against — no endpoint uses them yet (Phase 3 is
    /// where <c>projects/{projectId}</c> routes actually exist), but
    /// they're not placeholders to be renamed later.
    /// </summary>
    public static IServiceCollection AddForgeAuthorization(this IServiceCollection services)
    {
        services.AddScoped<CurrentUser>();
        services.AddScoped<ICurrentUser>(sp => sp.GetRequiredService<CurrentUser>());

        services.AddScoped<IAuthorizationHandler, WorkspaceRoleHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, NotFoundOnForbidAuthorizationMiddlewareResultHandler>();

        services.AddAuthorizationBuilder()
            .AddPolicy(BearerPolicy, policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser())
            .AddPolicy("project:read", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Viewer, WorkspaceResourceKind.Project, "projectId")))
            .AddPolicy("project:write", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Editor, WorkspaceResourceKind.Project, "projectId")));

        return services;
    }
}

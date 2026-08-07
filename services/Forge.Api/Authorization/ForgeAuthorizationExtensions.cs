using Forge.Api.Features.Projects;
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
    /// <c>project:read</c>/<c>project:write</c> are the policies M5 Phase 3's
    /// project endpoints (docs/SPEC.md Section 13.3) are written against,
    /// keyed on a <c>projectId</c> route value. <c>workspace:read</c>/
    /// <c>workspace:write</c> are the same idea keyed on a
    /// <c>workspaceId</c> route value instead, for the workspace-scoped
    /// project list/create endpoints where there's no project yet to
    /// resolve a workspace from.
    /// </summary>
    public static IServiceCollection AddForgeAuthorization(this IServiceCollection services)
    {
        services.AddScoped<CurrentUser>();
        services.AddScoped<ICurrentUser>(sp => sp.GetRequiredService<CurrentUser>());

        services.AddScoped<IAuthorizationHandler, WorkspaceRoleHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, NotFoundOnForbidAuthorizationMiddlewareResultHandler>();
        services.AddSingleton<IDocumentValidator, DocumentValidator>();

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
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Editor, WorkspaceResourceKind.Project, "projectId")))
            .AddPolicy("workspace:read", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Viewer, WorkspaceResourceKind.Workspace, "workspaceId")))
            .AddPolicy("workspace:write", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Editor, WorkspaceResourceKind.Workspace, "workspaceId")));

        return services;
    }
}

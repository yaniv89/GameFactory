using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Play;
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

    /// <summary>M7 Phase 7's Play Services surface — a published game's runtime authenticates its anonymous <see cref="Domain.Entities.Player"/> identity via <see cref="PlayTokenAuthenticationHandler"/> instead, never the editor's OpenIddict Bearer token (<see cref="Domain.Entities.Player"/>'s own doc comment on why these are deliberately separate identities).</summary>
    public const string PlayTokenPolicy = "play:token";

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
    /// resolve a workspace from. <c>workspace:billing</c> requires Admin,
    /// stricter than the other two — docs/SPEC.md Section 23.6: a viewer
    /// reaching a billing page is a permission-denied state, not merely a
    /// read-only one. <c>workspace:pro</c> is the plan gate itself
    /// (Section 23.2/23.5) — registered here, consumed starting M6.
    /// </summary>
    public static IServiceCollection AddForgeAuthorization(this IServiceCollection services)
    {
        services.AddScoped<CurrentUser>();
        services.AddScoped<ICurrentUser>(sp => sp.GetRequiredService<CurrentUser>());

        services.AddScoped<IAuthorizationHandler, WorkspaceRoleHandler>();
        services.AddScoped<IAuthorizationHandler, PlanGateHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, WorkspaceAuthorizationMiddlewareResultHandler>();
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
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Editor, WorkspaceResourceKind.Workspace, "workspaceId")))
            .AddPolicy("workspace:billing", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new WorkspaceRoleRequirement(WorkspaceRole.Admin, WorkspaceResourceKind.Workspace, "workspaceId")))
            .AddPolicy("workspace:pro", policy => policy
                .AddAuthenticationSchemes(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Requirements.Add(new PlanGateRequirement(WorkspaceResourceKind.Workspace, "workspaceId")))
            .AddPolicy(PlayTokenPolicy, policy => policy
                .AddAuthenticationSchemes(PlayTokenAuthenticationHandler.SchemeName)
                .RequireAuthenticatedUser());

        return services;
    }
}

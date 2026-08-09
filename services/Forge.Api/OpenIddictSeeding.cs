using Forge.Infrastructure;
using OpenIddict.Abstractions;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace Forge.Api;

/// <summary>
/// Registers the editor SPA as an OpenIddict client on startup, if it
/// isn't already registered — idempotent, so it's safe to run on every
/// boot (including every test host boot via ForgeWebApplicationFactory).
/// Without this, /connect/authorize rejects every request with
/// invalid_client before any of this API's own code runs.
///
/// The redirect URI is a placeholder for the editor's dev server
/// (packages/editor/playwright.config.ts's own PORT constant) — the SPA
/// doesn't have an OIDC callback route built yet (that's editor-side
/// work, not this backend phase), so this will need a real production
/// redirect URI added once it does, not just this one.
/// </summary>
public static class OpenIddictSeeding
{
    public const string EditorClientId = "forge-editor";

    public static async Task SeedAsync(WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();

        if (await manager.FindByClientIdAsync(EditorClientId) is not null)
        {
            return;
        }

        await manager.CreateAsync(new OpenIddictApplicationDescriptor
        {
            ClientId = EditorClientId,
            ClientType = ClientTypes.Public, // No client secret — a browser SPA can't keep one.
            RedirectUris = { new Uri("http://localhost:5190/auth/callback") },
            Permissions =
            {
                Permissions.Endpoints.Authorization,
                Permissions.Endpoints.Token,
                Permissions.GrantTypes.AuthorizationCode,
                Permissions.GrantTypes.RefreshToken,
                Permissions.ResponseTypes.Code,
                Permissions.Scopes.Email,
                Permissions.Scopes.Profile,
                Permissions.Prefixes.Scope + Scopes.OfflineAccess,
                Permissions.Prefixes.Scope + DependencyInjection.ApiScope,
            },
            Requirements = { Requirements.Features.ProofKeyForCodeExchange },
        });
    }
}

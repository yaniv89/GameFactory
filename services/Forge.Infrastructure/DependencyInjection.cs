using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenIddict.Abstractions;
using StackExchange.Redis;

namespace Forge.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers <see cref="ForgeDbContext"/> against the pooled Npgsql
    /// connection named "Forge" in configuration. Pool size is left to the
    /// Npgsql connection-string default (100) at the provider level, but
    /// docs/SPEC.md Section 5.5 is explicit that the number that actually
    /// matters is <c>pool_size × api_instance_count &lt; Postgres
    /// max_connections</c> — that's an environment-level sizing decision
    /// (connection string + instance count), not something to hardcode
    /// here, and it isn't set until this is actually deployed (M5 Phase
    /// 6's load test is where that number first gets checked against
    /// something real).
    /// </summary>
    public static IServiceCollection AddForgeInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Forge")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Forge configuration.");

        services.AddDbContext<ForgeDbContext>(options => options
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention());

        return services;
    }

    /// <summary>
    /// One shared <see cref="IConnectionMultiplexer"/> for the whole
    /// process (StackExchange.Redis's own documented pattern — it's
    /// already a thread-safe, pooled multiplexer, not a per-request
    /// connection to open and close) backing <see cref="RedisRateLimiter"/>
    /// (docs/SPEC.md Section 5.5, CLAUDE.md Section 1.5 guardrail 18: rate
    /// limiting is centralized in Redis, never counted in-process, since a
    /// per-instance counter is bypassable by hitting a different replica
    /// behind the load balancer).
    /// </summary>
    public static IServiceCollection AddForgeRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Redis")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Redis configuration.");

        services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(connectionString));
        services.AddSingleton<IRateLimiter, RedisRateLimiter>();

        return services;
    }

    /// <summary>The custom OpenIddict scope gating access to this API's own resource endpoints, as opposed to the standard OIDC scopes (openid/email/profile/offline_access).</summary>
    public const string ApiScope = "forge_api";

    /// <summary>
    /// ASP.NET Core Identity (password accounts, lockout, the token
    /// providers email verification/password reset run on) plus OpenIddict
    /// (the OIDC authorization server — docs/SPEC.md Section 23.1,
    /// CLAUDE.md Section 2.1). Both persist through <see cref="ForgeDbContext"/>.
    ///
    /// <paramref name="isDevelopment"/> gates two things that are only
    /// ever safe outside a real deployment: OpenIddict's ephemeral,
    /// self-signed development signing/encryption certificates, and
    /// disabling OpenIddict's HTTPS requirement on its own endpoints (so
    /// local dev and the test host, both plain HTTP, work at all). Passing
    /// <c>false</c> — any real environment — with no real certificate
    /// configured throws at startup rather than silently issuing tokens
    /// signed by a throwaway key nobody else can verify (CLAUDE.md Section
    /// 1.1 guardrail 6: a documented local-only override that fails the
    /// production config check, not a silent fallback).
    /// </summary>
    public static IServiceCollection AddForgeAuth(this IServiceCollection services, bool isDevelopment)
    {
        services
            .AddIdentity<ForgeIdentityUser, IdentityRole<Guid>>(options =>
            {
                // NIST 800-63B-style length-based strength over composition
                // rules — docs/SPEC.md Section 23.3's "Identity's password
                // rules" applies to every account, not just authors.
                options.Password.RequiredLength = 12;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireLowercase = false;
                options.User.RequireUniqueEmail = true;
                // Free tier keeps full editor access while unverified —
                // Section 23.3: the gate is at checkout/publish, not login.
                options.SignIn.RequireConfirmedEmail = false;
                options.Lockout.MaxFailedAccessAttempts = 10;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            })
            .AddEntityFrameworkStores<ForgeDbContext>()
            .AddDefaultTokenProviders();

        services.ConfigureApplicationCookie(options =>
        {
            // No server-rendered login page exists (or ever will — the
            // editor SPA owns the login form, CLAUDE.md Section 2.2). An
            // unauthenticated hit on /connect/authorize should tell the
            // SPA "log in first", not redirect into a 404. The SPA calls
            // POST /api/v1/auth/login itself to establish this cookie
            // before ever navigating to /connect/authorize.
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.Cookie.HttpOnly = true;
        });

        services.AddOpenIddict()
            .AddCore(options => options
                .UseEntityFrameworkCore()
                .UseDbContext<ForgeDbContext>())
            .AddServer(options =>
            {
                // No SetEndSessionEndpointUris: /connect/logout is a plain
                // custom endpoint (Features/Auth/LogoutEndpoint.cs), not
                // OpenIddict's own EndSession flow — that flow is built
                // for federated front-channel logout coordination
                // (id_token_hint, post_logout_redirect_uri, a hosted
                // confirmation page), none of which applies to a
                // first-party SPA revoking its own session.
                options
                    .SetAuthorizationEndpointUris("/connect/authorize")
                    .SetTokenEndpointUris("/connect/token");

                options
                    .AllowAuthorizationCodeFlow()
                    .RequireProofKeyForCodeExchange();
                options.AllowRefreshTokenFlow();

                options.RegisterScopes(
                    OpenIddictConstants.Scopes.OpenId,
                    OpenIddictConstants.Scopes.Email,
                    OpenIddictConstants.Scopes.Profile,
                    OpenIddictConstants.Scopes.OfflineAccess,
                    ApiScope);

                // Access tokens: short-lived, memory-only in the SPA.
                // Refresh tokens: rotated on every use, reuse detection
                // revokes the whole family (CLAUDE.md Section 4.7 of the
                // brief) — both are OpenIddict defaults here, not
                // something this call has to opt into separately.
                options.SetAccessTokenLifetime(TimeSpan.FromMinutes(15));
                options.SetRefreshTokenLifetime(TimeSpan.FromDays(30));
                options.UseReferenceRefreshTokens(); // revocable server-side, not just short-lived.

                if (isDevelopment)
                {
                    options.AddDevelopmentEncryptionCertificate();
                    options.AddDevelopmentSigningCertificate();
                }
                else
                {
                    throw new InvalidOperationException(
                        "OpenIddict has no real signing/encryption certificate configured. " +
                        "Development certificates only run when isDevelopment is true. Real " +
                        "environments must supply real certificates via Key Vault / managed " +
                        "identity (CLAUDE.md Section 4.7) before this host can start.");
                }

                var aspNetCoreBuilder = options
                    .UseAspNetCore()
                    .EnableAuthorizationEndpointPassthrough()
                    .EnableTokenEndpointPassthrough();

                if (isDevelopment)
                {
                    // OpenIddict refuses to issue tokens over plain HTTP
                    // by default. Local dev and the WebApplicationFactory
                    // test host are both plain HTTP — real environments
                    // terminate TLS upstream and must keep this check on.
                    aspNetCoreBuilder.DisableTransportSecurityRequirement();
                }
            })
            .AddValidation(options =>
            {
                options.UseLocalServer();
                options.UseAspNetCore();
            });

        services.AddScoped<IEmailSender, LoggingEmailSender>();

        return services;
    }
}

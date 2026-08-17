using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Play;
using Forge.Infrastructure.RateLimiting;
using Forge.Infrastructure.Realtime;
using Forge.Infrastructure.Storage;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore; // OpenIddictServerAspNetCoreHelpers.GetHttpRequest(OpenIddictServerTransaction) lives here, not in OpenIddict.Server.AspNetCore, despite the extended type's own namespace.
using OpenIddict.Abstractions;
using OpenIddict.Server;
using StackExchange.Redis;
using Stripe;
using static OpenIddict.Server.OpenIddictServerEvents;

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

    /// <summary>
    /// Stripe Checkout/Billing Portal (M5 Phase 5, docs/SPEC.md Section
    /// 23.2/23.5). All four settings are secrets or environment-specific
    /// identifiers — the appsettings.json values are local-dev/test-mode
    /// placeholders (CLAUDE.md Section 4.7), never real production keys.
    /// </summary>
    public static IServiceCollection AddForgeBilling(this IServiceCollection services, IConfiguration configuration)
    {
        var secretKey = configuration["Stripe:SecretKey"]
            ?? throw new InvalidOperationException("Missing Stripe:SecretKey configuration.");
        var webhookSecret = configuration["Stripe:WebhookSecret"]
            ?? throw new InvalidOperationException("Missing Stripe:WebhookSecret configuration.");
        var proPriceId = configuration["Stripe:ProPriceId"]
            ?? throw new InvalidOperationException("Missing Stripe:ProPriceId configuration.");
        var studioPriceId = configuration["Stripe:StudioPriceId"]
            ?? throw new InvalidOperationException("Missing Stripe:StudioPriceId configuration.");

        var stripeClient = new StripeClient(secretKey);
        services.AddSingleton<IStripeBillingClient>(_ => new StripeBillingClient(stripeClient, proPriceId, studioPriceId));
        services.AddSingleton(new StripeWebhookOptions(webhookSecret));
        services.AddSingleton(new StripePriceOptions(proPriceId, studioPriceId));

        return services;
    }

    /// <summary>
    /// M7 Phase 4's marketplace purchase flow (docs/SPEC.md Section
    /// 16.1) — Stripe Connect accounts and destination-charge Checkout
    /// Sessions, a different API surface from <see cref="AddForgeBilling"/>'s
    /// subscription billing even though both ultimately call the same
    /// Stripe account (one <c>Stripe:SecretKey</c>, read independently
    /// here rather than threaded through from that method, since a
    /// second lightweight <see cref="StripeClient"/> instance from the
    /// same key is how Stripe.net is designed to be used — it holds no
    /// exclusive resource worth sharing).
    /// </summary>
    public static IServiceCollection AddForgeMarketplaceBilling(this IServiceCollection services, IConfiguration configuration)
    {
        var secretKey = configuration["Stripe:SecretKey"]
            ?? throw new InvalidOperationException("Missing Stripe:SecretKey configuration.");

        var stripeClient = new StripeClient(secretKey);
        services.AddSingleton<IStripeMarketplaceClient>(_ => new StripeMarketplaceClient(stripeClient));

        return services;
    }

    /// <summary>
    /// M7 Phase 7: Play Services (docs/SPEC.md Section 17) — anonymous
    /// player identity's <see cref="PlayTokenService"/>/<see cref="PlayTokenAuthenticationHandler"/>,
    /// and the Azure Table Storage client backing cloud saves,
    /// leaderboards, achievements, and analytics ingestion
    /// (<see cref="SaveSlotStore"/>/<see cref="LeaderboardStore"/>/
    /// <see cref="AchievementStore"/>/<see cref="AnalyticsEventStore"/>).
    /// <c>ConnectionStrings:Table</c> is a separate config key from
    /// <c>ConnectionStrings:Blob</c> even though both point at the same
    /// Azurite/Azure Storage account in local dev and in this repo's own
    /// tests (Azurite emulates blob/queue/table together under one
    /// account) — a real Azure Storage account's blob and table
    /// endpoints share the account key too, but keeping the config keys
    /// separate documents each store's own dependency rather than
    /// implying <c>AddForgeBundleStorage</c>'s blob connection secretly
    /// also has to be table-capable.
    /// </summary>
    public static IServiceCollection AddForgePlayServices(this IServiceCollection services, IConfiguration configuration)
    {
        var tokenSecret = configuration["PlayServices:TokenSecret"]
            ?? throw new InvalidOperationException("Missing PlayServices:TokenSecret configuration.");
        services.AddSingleton(new PlayTokenOptions(tokenSecret));
        services.AddSingleton<PlayTokenService>();

        services.AddAuthentication()
            .AddScheme<AuthenticationSchemeOptions, PlayTokenAuthenticationHandler>(PlayTokenAuthenticationHandler.SchemeName, _ => { });

        var tableConnectionString = configuration.GetConnectionString("Table")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Table configuration.");
        services.AddSingleton(_ => new TableServiceClient(tableConnectionString));
        services.AddSingleton<SaveSlotStore>();
        services.AddSingleton<LeaderboardStore>();
        services.AddSingleton<AchievementStore>();
        services.AddSingleton<AnalyticsEventStore>();

        return services;
    }

    /// <summary>
    /// M6 Phase 2: where a published package version's bundle actually
    /// lives (docs/SPEC.md Section 6.2, CLAUDE.md Section 2.1's pinned
    /// Blob choice). The container is created eagerly, the same
    /// fail-fast-at-startup posture as every other required-config check
    /// in this file, rather than surfacing a missing-container error on
    /// the first real publish attempt.
    /// </summary>
    public static IServiceCollection AddForgeBundleStorage(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Blob")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Blob configuration.");
        var containerName = configuration["Blob:PackagesContainer"]
            ?? throw new InvalidOperationException("Missing Blob:PackagesContainer configuration.");

        services.AddSingleton(_ =>
        {
            var container = new BlobContainerClient(connectionString, containerName);
            container.CreateIfNotExists();
            return container;
        });
        services.AddSingleton<IPackageBundleStorage, AzureBlobPackageBundleStorage>();

        return services;
    }

    /// <summary>
    /// docs/adr/0010 Decision 4: where <c>Forge.Functions.Build</c>
    /// uploads a build's <c>index.html</c> + <c>meta.json</c>. Deliberately
    /// its own <see cref="BlobContainerClient"/> singleton, not a second
    /// caller of <see cref="AddForgeBundleStorage"/> pointed at a
    /// different container name: that method's own singleton
    /// registration isn't keyed, so a process calling both this and
    /// <see cref="AddForgeBundleStorage"/> would silently leave
    /// <see cref="IPackageBundleStorage"/> and <see cref="IBuildBundleStorage"/>
    /// resolving whichever <see cref="BlobContainerClient"/> registered
    /// last. Not a real risk today — only <c>Forge.Functions.Build</c>
    /// calls this method, and it never calls <see cref="AddForgeBundleStorage"/>
    /// — but worth stating plainly rather than leaving a landmine an
    /// unrelated future change could quietly step on.
    /// </summary>
    public static IServiceCollection AddForgeBuildBundleStorage(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Blob")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Blob configuration.");
        var containerName = configuration["Blob:BuildsContainer"]
            ?? throw new InvalidOperationException("Missing Blob:BuildsContainer configuration.");

        services.AddSingleton(_ =>
        {
            var container = new BlobContainerClient(connectionString, containerName);
            container.CreateIfNotExists();
            return container;
        });
        services.AddSingleton<IBuildBundleStorage, AzureBlobBuildBundleStorage>();

        return services;
    }

    /// <summary>
    /// docs/adr/0012 Decision 6: the two-container Blob layout backing
    /// <see cref="IAssetStorage"/>. Deliberately does not register either
    /// <see cref="BlobContainerClient"/> as its own DI singleton the way
    /// <see cref="AddForgeBundleStorage"/>/<see cref="AddForgeBuildBundleStorage"/>
    /// do — both containers are private implementation detail of one
    /// <see cref="AzureBlobAssetStorage"/> instance, constructed directly
    /// inside this factory delegate, which sidesteps those two methods'
    /// own documented landmine (an unkeyed <see cref="BlobContainerClient"/>
    /// registration silently resolving whichever container registered
    /// last if a process ever called more than one of these methods) by
    /// construction rather than by convention.
    /// </summary>
    public static IServiceCollection AddForgeAssetStorage(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Blob")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Blob configuration.");
        var quarantineContainerName = configuration["Blob:AssetsQuarantineContainer"]
            ?? throw new InvalidOperationException("Missing Blob:AssetsQuarantineContainer configuration.");
        var publicContainerName = configuration["Blob:AssetsContainer"]
            ?? throw new InvalidOperationException("Missing Blob:AssetsContainer configuration.");

        services.AddSingleton<IAssetStorage>(_ =>
        {
            var quarantine = new BlobContainerClient(connectionString, quarantineContainerName);
            quarantine.CreateIfNotExists();
            var pub = new BlobContainerClient(connectionString, publicContainerName);
            pub.CreateIfNotExists();
            return new AzureBlobAssetStorage(quarantine, pub);
        });

        return services;
    }

    /// <summary>
    /// SignalR itself (M7 Phase 1, docs/SPEC.md Section 13.2's
    /// <c>WS /hubs/collab</c>) plus the Redis backplane, non-negotiable
    /// the moment a second API instance exists (CLAUDE.md Section 1.5
    /// guardrail 20 — "there is no add it later for this one, since it
    /// changes the hub's connection model at the root"). Uses its own
    /// connection string, not the shared <see cref="IConnectionMultiplexer"/>
    /// singleton <see cref="AddForgeRateLimiting"/> registers:
    /// <c>AddStackExchangeRedis</c> owns and pools its own connection
    /// internally as part of the SignalR Redis protocol implementation,
    /// same as the framework's own documented setup — sharing the rate
    /// limiter's multiplexer here would couple two independent
    /// subsystems' connection lifecycles for no real benefit.
    /// <see cref="IPresenceStore"/> is separate from this and does reuse
    /// the shared multiplexer (its own doc comment explains why).
    /// </summary>
    public static IServiceCollection AddForgeRealtime(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Redis")
            ?? throw new InvalidOperationException("Missing ConnectionStrings:Redis configuration.");

        services.AddSignalR().AddStackExchangeRedis(connectionString);
        services.AddSingleton<IPresenceStore, RedisPresenceStore>();

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
    ///
    /// <paramref name="configuration"/> also selects the <see cref="IEmailSender"/>
    /// registered here — see that interface's own doc comment.
    /// </summary>
    public static IServiceCollection AddForgeAuth(this IServiceCollection services, IConfiguration configuration, bool isDevelopment)
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

                // The read half of the httpOnly-refresh-cookie pair
                // (RefreshTokenCookie.cs's own doc comment has the full
                // "why"; the write half is RefreshTokenCookieMiddleware,
                // NOT an OpenIddict event handler — see that class's doc
                // comment for why the obvious event-handler approach
                // doesn't work here). The client never sends refresh_token
                // as a form field for a refresh grant — authClient.ts has
                // nothing to send, the cookie is httpOnly — so this reads
                // it from the cookie and populates context.Request.RefreshToken
                // before OpenIddict's own grant validation runs.
                // SetOrder(int.MaxValue) so the built-in form-body
                // extraction has already run and left the field empty for
                // this handler to fill in; confirmed safe (unlike the
                // outgoing side) because ExtractTokenRequestContext has no
                // short-circuiting finalization handler ahead of a
                // Custom-ordered one the way ProcessSignInContext does.
                options.AddEventHandler<ExtractTokenRequestContext>(builder => builder
                    .UseInlineHandler(context =>
                    {
                        if (context.Request is not null
                            && context.Request.GrantType == OpenIddictConstants.GrantTypes.RefreshToken
                            && string.IsNullOrEmpty(context.Request.RefreshToken))
                        {
                            var httpContext = context.Transaction.GetHttpRequest()?.HttpContext;
                            if (httpContext is not null
                                && httpContext.Request.Cookies.TryGetValue(RefreshTokenCookie.Name, out var cookieValue)
                                && !string.IsNullOrEmpty(cookieValue))
                            {
                                context.Request.RefreshToken = cookieValue;
                            }
                        }
                        return default;
                    })
                    .SetOrder(int.MaxValue));
            })
            .AddValidation(options =>
            {
                options.UseLocalServer();
                options.UseAspNetCore();
            });

        var smtpHost = configuration["Smtp:Host"];
        if (!string.IsNullOrEmpty(smtpHost))
        {
            var smtpPort = int.Parse(configuration["Smtp:Port"] ?? "1025");
            var fromAddress = configuration["Smtp:FromAddress"] ?? "noreply@forge.dev";
            services.AddSingleton(new SmtpOptions(smtpHost, smtpPort, fromAddress));
            services.AddScoped<IEmailSender, SmtpEmailSender>();
        }
        else
        {
            services.AddScoped<IEmailSender, LoggingEmailSender>();
        }

        return services;
    }
}

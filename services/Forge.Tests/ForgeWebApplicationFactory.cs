using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Email;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.StackExchangeRedis;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using StackExchange.Redis;
using Testcontainers.Azurite;
using Testcontainers.PostgreSql;
using Testcontainers.Redis;
using Xunit;

namespace Forge.Tests;

/// <summary>
/// Every integration test in this project should use this instead of a
/// bare <c>WebApplicationFactory&lt;Program&gt;</c>. Two things it does
/// that a bare factory wouldn't:
///
/// 1. Explicitly forces the Development environment rather than relying
///    on whatever <c>WebApplicationFactory</c>'s undocumented-here
///    default resolves to in a CI process with no
///    <c>ASPNETCORE_ENVIRONMENT</c> set — that matters for real starting
///    M5 Phase 2: Program.cs's <c>AddForgeAuth(isDevelopment)</c> throws
///    at startup outside Development (no real signing certificate is
///    configured for any other environment, deliberately — CLAUDE.md
///    Section 1.1 guardrail 6), so guessing wrong here would fail every
///    integration test, not just the auth ones.
/// 2. Points <c>ConnectionStrings:Forge</c> at a real, ephemeral
///    Postgres 16 container (same Testcontainers approach as
///    ForgeDbContextTests.cs) instead of appsettings.json's local-dev
///    placeholder, which points nowhere in CI, and creates the schema by
///    applying the real EF Core migrations before any test runs.
///
///    This is done by replacing the <c>DbContextOptions&lt;ForgeDbContext&gt;</c>
///    service registration directly in <see cref="ConfigureWebHost"/>,
///    not by pushing an override through <c>IHostBuilder.ConfigureAppConfiguration</c>.
///    The latter was tried first and looked correct, but doesn't win: this
///    app's entry point (<c>Program.cs</c> via <c>AddForgeInfrastructure</c>)
///    reads <c>IConfiguration.GetConnectionString("Forge")</c> eagerly while
///    building the <see cref="WebApplicationBuilder"/>, and confirmed by a
///    real CI run, <c>appsettings.json</c>'s own connection-string source
///    still wins that race against a queued <c>ConfigureAppConfiguration</c>
///    delegate under <c>WebApplicationFactory</c>'s deferred-host mechanism
///    for minimal-API entry points — every test hit the literal
///    <c>appsettings.json</c> placeholder (<c>127.0.0.1:5432</c>, refused)
///    instead of the container's real mapped port. Overriding the
///    <see cref="IServiceCollection"/> registration directly sidesteps that
///    ordering entirely.
///
///    Schema creation now runs the real, checked-in EF Core migrations
///    (<c>Database.Migrate()</c>, <c>services/Forge.Infrastructure/Persistence/Migrations/</c>)
///    rather than <c>EnsureCreated()</c> — the two are mutually exclusive
///    (EF tracks schema state incompatibly between them), so this is the
///    one place in the whole test suite that actually applies and
///    verifies the migrations are correct, the same real Postgres every
///    other test in this project already uses. This has to happen inside
///    that same <c>ConfigureTestServices</c> delegate too, not after
///    <c>base.CreateHost</c> returns as an earlier version of this class
///    did: <c>Program.cs</c> calls <c>OpenIddictSeeding.SeedAsync</c> —
///    which queries real tables — during host startup itself (before
///    <c>app.Run()</c>, deep inside <c>base.CreateHost</c>'s call into
///    <c>Program.Main</c>), so creating the schema afterward is too late;
///    a real CI run confirmed this with <c>relation "OpenIddictApplications"
///    does not exist</c>.
///
/// 3. Same story for <c>ConnectionStrings:Redis</c> (M5 Phase 4):
///    <c>AddForgeRateLimiting</c> reads it eagerly the same way
///    <c>AddForgeInfrastructure</c> does, so it gets the same
///    ConfigureTestServices-level override — replacing the
///    <see cref="IConnectionMultiplexer"/> registration directly — rather
///    than a config-provider override that would lose the same ordering
///    race.
///
/// 4. No real Stripe test-mode API key exists in this environment (M5
///    Phase 5) — <see cref="IStripeBillingClient"/> is swapped for
///    <see cref="FakeStripeBillingClient"/> the same way <c>IEmailSender</c>
///    is, since a real call would just fail against
///    <c>appsettings.json</c>'s placeholder key. <c>StripeWebhookOptions</c>/
///    <c>StripePriceOptions</c> are NOT overridden — their appsettings.json
///    placeholder values are deterministic and known, so webhook tests
///    reference them directly instead.
///
/// 5. Same Testcontainers approach again for <c>ConnectionStrings:Blob</c>
///    (M6 Phase 2): a real Azurite container, not a fake — publish-pipeline
///    tests exercise the real <c>BlobContainerClient</c> and its
///    create-only-if-not-exists immutability check, not a stand-in that
///    would silently pass even if that check were broken.
///
/// 6. <c>ConnectionStrings:Redis</c> strikes again, differently, for
///    SignalR's own Redis backplane (M7 Phase 1's <c>AddForgeRealtime</c>):
///    <c>AddStackExchangeRedis</c> doesn't resolve an
///    <see cref="IConnectionMultiplexer"/> from DI at all — it connects
///    its own, built from whatever connection string
///    <c>Program.cs</c> passed it at startup, so overriding the shared
///    multiplexer above (point 3) never reaches it. Caught by a real CI
///    failure, not anticipated up front: a hub's
///    <c>Clients.Caller.SendAsync</c> call always round-trips through the
///    Redis backplane's pub/sub, even for a single connected client in a
///    single-process test host, so a backplane pointed at
///    <c>appsettings.json</c>'s placeholder just swallows every send.
///    Fixed via <c>RedisOptions.ConnectionFactory</c>, the package's own
///    documented override point for supplying an already-connected
///    multiplexer — registered through <c>services.Configure&lt;RedisOptions&gt;</c>
///    here, which composes onto (and, running later, wins over)
///    <c>AddForgeRealtime</c>'s own configuration rather than replacing a
///    single DI registration the way points 1-5 do.
///
/// 7. <c>ConnectionStrings:Table</c> (M7 Phase 7's Play Services) reuses
///    the same Azurite container as point 5 rather than spinning up a
///    second one — Azurite emulates blob/queue/table together under one
///    account, so the fix is the same direct-registration-replacement
///    pattern as <c>BlobContainerClient</c> just above, not a new
///    container.
/// </summary>
public sealed class ForgeWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder().WithImage("postgres:16").Build();
    private readonly RedisContainer _redis = new RedisBuilder().WithImage("redis:7").Build();
    // No explicit .WithImage() pin here unlike the two containers above:
    // Testcontainers.Azurite's own default image tag is the one this
    // package version was tested against, and this sandbox can't verify
    // a hand-picked tag actually exists on the registry before a real CI
    // run does — safer to trust the package's own default than guess.
    //
    // --skipApiVersionCheck: a real CI run confirmed the Azure.Storage.Blobs
    // client (12.24.0) sends a newer x-ms-version header than this Azurite
    // image's REST API layer recognizes ("The API version ... is not
    // supported by Azurite"), which the client surfaces as a 400 on every
    // single blob call — this is the emulator's own documented escape
    // hatch for exactly that skew (Azurite's error message names this flag
    // directly), not a security bypass: it only relaxes a version-string
    // allowlist on an ephemeral, credential-less local emulator that never
    // runs in production, and every actual request still executes for
    // real, not a mock — the create-only-if-not-exists check this whole
    // container exists to verify is still genuinely exercised.
    private readonly AzuriteContainer _azurite = new AzuriteBuilder().WithCommand("--skipApiVersionCheck").Build();

    /// <summary>
    /// The real Azurite container's own connection string, exposed for
    /// tests that need to construct their own <see cref="BlobContainerClient"/>
    /// against a container this factory doesn't register in DI itself —
    /// docs/adr/0010's <c>builds</c> container (<see cref="Forge.Infrastructure.Storage.IBuildBundleStorage"/>)
    /// is Forge.Functions.Build's own concern, never Forge.Api's, so
    /// unlike <c>ConnectionStrings:Blob</c>'s "packages" container above
    /// there's no reason for this host to register a
    /// <see cref="BlobContainerClient"/> for it — same reasoning
    /// <see cref="Features.Scan.ScanOrchestratorTests"/>'s own
    /// <c>BuildOrchestrator</c> helper already applies to constructing a
    /// <c>SmokeRunGate</c> directly rather than resolving one from DI.
    /// </summary>
    public string AzuriteConnectionString => _azurite.GetConnectionString();

    /// <summary>
    /// No real email provider is configured (IEmailSender's own doc
    /// comment) — this captures what LoggingEmailSender would otherwise
    /// only write to a logger, so tests can read the real
    /// verification/reset token an endpoint actually generated.
    /// </summary>
    public CapturingEmailSender EmailSender { get; } = new();

    /// <summary>No real Stripe API key exists in this environment (see class remarks) — this captures what would have been requested.</summary>
    public FakeStripeBillingClient BillingClient { get; } = new();

    /// <summary>Same story as <see cref="BillingClient"/>, for M7 Phase 4's marketplace Connect/purchase flow.</summary>
    public FakeStripeMarketplaceClient MarketplaceClient { get; } = new();

    public async Task InitializeAsync() => await Task.WhenAll(_postgres.StartAsync(), _redis.StartAsync(), _azurite.StartAsync());

    async Task IAsyncLifetime.DisposeAsync() => await Task.WhenAll(
        _postgres.DisposeAsync().AsTask(), _redis.DisposeAsync().AsTask(), _azurite.DisposeAsync().AsTask());

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(EmailSender);

            services.RemoveAll<IStripeBillingClient>();
            services.AddSingleton<IStripeBillingClient>(BillingClient);

            services.RemoveAll<IStripeMarketplaceClient>();
            services.AddSingleton<IStripeMarketplaceClient>(MarketplaceClient);

            var connectionString = _postgres.GetConnectionString();
            services.RemoveAll<DbContextOptions<ForgeDbContext>>();
            services.AddDbContext<ForgeDbContext>(options => options
                .UseNpgsql(connectionString)
                .UseSnakeCaseNamingConvention());

            using var db = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
                .UseNpgsql(connectionString)
                .UseSnakeCaseNamingConvention()
                .Options);
            db.Database.Migrate();

            var redisConnectionString = _redis.GetConnectionString();
            // One real, lazily-created connection to the test container,
            // shared by both registrations below — not two independent
            // ones to the same target.
            var testMultiplexer = new Lazy<IConnectionMultiplexer>(() => ConnectionMultiplexer.Connect(redisConnectionString));
            services.RemoveAll<IConnectionMultiplexer>();
            services.AddSingleton(_ => testMultiplexer.Value);

            // M7 Phase 1's AddForgeRealtime calls AddStackExchangeRedis
            // with the connection string Program.cs read from
            // appsettings.json at startup (a placeholder that points
            // nowhere in CI) — that call configures RedisOptions.Configuration
            // directly, which the IConnectionMultiplexer override above
            // never touches (SignalR's Redis backplane owns and connects
            // its own StackExchange.Redis client, it doesn't resolve one
            // from DI). Caught by a real CI run: CollabHubTests'
            // two-member presence test timed out waiting for
            // "presence:roster" — the hub's Clients.Caller.SendAsync
            // call always goes through the Redis backplane's pub/sub,
            // even for a single-process test host, so a backplane that
            // can't reach real Redis means that send goes nowhere, not
            // that it falls back to a direct in-process delivery.
            // RedisOptions.ConnectionFactory is the documented override
            // point for reusing an already-connected multiplexer instead
            // of letting AddStackExchangeRedis parse/reconnect from the
            // wrong connection string; registered here (via
            // services.Configure, which composes rather than replaces)
            // so it runs after and wins over AddForgeRealtime's own call.
            services.Configure<RedisOptions>(options =>
            {
                options.ConnectionFactory = _ => Task.FromResult(testMultiplexer.Value);
            });

            var blobConnectionString = _azurite.GetConnectionString();
            services.RemoveAll<BlobContainerClient>();
            services.AddSingleton(_ =>
            {
                var container = new BlobContainerClient(blobConnectionString, "packages");
                container.CreateIfNotExists();
                return container;
            });

            // M7 Phase 7: same Azurite container as point 5 above backs
            // Table Storage too (Azurite emulates blob/queue/table under
            // one account) — no second container, just a second client
            // pointed at the same connection string. Same eager-read
            // race as every other ConnectionStrings:* override in this
            // class (point 2's own remarks): AddForgePlayServices already
            // built a TableServiceClient from appsettings.json's
            // placeholder by the time this delegate runs, so the fix is
            // the same one used for BlobContainerClient just above —
            // replace the registration directly rather than trying to
            // win a race through IConfiguration.
            services.RemoveAll<TableServiceClient>();
            services.AddSingleton(_ => new TableServiceClient(blobConnectionString));
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        return base.CreateHost(builder);
    }
}

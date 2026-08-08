using Forge.Infrastructure.Email;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using StackExchange.Redis;
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
///    placeholder, which points nowhere in CI, and creates the schema
///    via EnsureCreated before any test runs.
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
///    Schema creation (<c>EnsureCreated</c>) has to happen inside that same
///    <c>ConfigureTestServices</c> delegate too, not after <c>base.CreateHost</c>
///    returns as an earlier version of this class did: <c>Program.cs</c>
///    calls <c>OpenIddictSeeding.SeedAsync</c> — which queries real tables
///    — during host startup itself (before <c>app.Run()</c>, deep inside
///    <c>base.CreateHost</c>'s call into <c>Program.Main</c>), so creating
///    the schema afterward is too late; a real CI run confirmed this with
///    <c>relation "OpenIddictApplications" does not exist</c>.
///
/// 3. Same story for <c>ConnectionStrings:Redis</c> (M5 Phase 4):
///    <c>AddForgeRateLimiting</c> reads it eagerly the same way
///    <c>AddForgeInfrastructure</c> does, so it gets the same
///    ConfigureTestServices-level override — replacing the
///    <see cref="IConnectionMultiplexer"/> registration directly — rather
///    than a config-provider override that would lose the same ordering
///    race.
/// </summary>
public sealed class ForgeWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder().WithImage("postgres:16").Build();
    private readonly RedisContainer _redis = new RedisBuilder().WithImage("redis:7").Build();

    /// <summary>
    /// No real email provider is configured (IEmailSender's own doc
    /// comment) — this captures what LoggingEmailSender would otherwise
    /// only write to a logger, so tests can read the real
    /// verification/reset token an endpoint actually generated.
    /// </summary>
    public CapturingEmailSender EmailSender { get; } = new();

    public async Task InitializeAsync() => await Task.WhenAll(_postgres.StartAsync(), _redis.StartAsync());

    async Task IAsyncLifetime.DisposeAsync() => await Task.WhenAll(_postgres.DisposeAsync().AsTask(), _redis.DisposeAsync().AsTask());

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(EmailSender);

            var connectionString = _postgres.GetConnectionString();
            services.RemoveAll<DbContextOptions<ForgeDbContext>>();
            services.AddDbContext<ForgeDbContext>(options => options
                .UseNpgsql(connectionString)
                .UseSnakeCaseNamingConvention());

            using var db = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
                .UseNpgsql(connectionString)
                .UseSnakeCaseNamingConvention()
                .Options);
            db.Database.EnsureCreated();

            var redisConnectionString = _redis.GetConnectionString();
            services.RemoveAll<IConnectionMultiplexer>();
            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnectionString));
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        return base.CreateHost(builder);
    }
}

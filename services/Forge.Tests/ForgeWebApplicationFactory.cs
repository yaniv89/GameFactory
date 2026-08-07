using Forge.Infrastructure.Email;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Testcontainers.PostgreSql;
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
/// </summary>
public sealed class ForgeWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder().WithImage("postgres:16").Build();

    /// <summary>
    /// No real email provider is configured (IEmailSender's own doc
    /// comment) — this captures what LoggingEmailSender would otherwise
    /// only write to a logger, so tests can read the real
    /// verification/reset token an endpoint actually generated.
    /// </summary>
    public CapturingEmailSender EmailSender { get; } = new();

    public Task InitializeAsync() => _container.StartAsync();

    Task IAsyncLifetime.DisposeAsync() => _container.DisposeAsync().AsTask();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(EmailSender);
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.ConfigureAppConfiguration((_, configBuilder) =>
        {
            configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Forge"] = _container.GetConnectionString(),
            });
        });

        var host = base.CreateHost(builder);

        using (var scope = host.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<ForgeDbContext>().Database.EnsureCreated();
        }

        return host;
    }
}

using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

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
}

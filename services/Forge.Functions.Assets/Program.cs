// docs/adr/0012 Decision 4's host process. Isolated-worker bootstrap
// (HostBuilder + ConfigureFunctionsWorkerDefaults), the same shape and
// the same reasoning as Forge.Functions.Build's own Program.cs — chosen
// over the newer FunctionsApplication.CreateBuilder alternative because
// it's the longer-established, more widely documented form, which
// matters here for the identical reason: nothing in this repo's own CI
// can compile-check the Azure Functions Worker SDK's package surface
// before a real GitHub-hosted-runner build does.
using Forge.Functions.Assets;
using Forge.Infrastructure;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        services.AddForgeInfrastructure(context.Configuration);
        services.AddForgeAssetStorage(context.Configuration);
        services.AddForgeAssetGate();
    })
    .Build();

await host.RunAsync();

// Same CS0433 fix as Forge.Functions.Build's own Program.cs: the .NET 9+
// SDK makes the compiler-generated top-level-statements Program class
// public by default, which collides with Forge.Api's own public Program
// the moment Forge.Tests references both assemblies unqualified. Forcing
// this one back to internal is correct, not a workaround — nothing
// outside this assembly needs this Program type; Forge.Tests references
// this assembly only for AssetRunner/AssetScanner/AssetOrchestrator.
internal partial class Program;

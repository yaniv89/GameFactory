// docs/adr/0016 Decision 2's host process. Isolated-worker bootstrap
// (HostBuilder + ConfigureFunctionsWorkerDefaults), the same shape and
// the same reasoning as Forge.Functions.Assets's own Program.cs.
using Forge.Functions.ArtGen;
using Forge.Infrastructure;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        services.AddForgeInfrastructure(context.Configuration);
        services.AddForgeArtGenerationStorage(context.Configuration);
        services.AddForgeArtGeneration(context.Configuration);
        services.AddForgeArtGenGate();
    })
    .Build();

await host.RunAsync();

// Same CS0433 fix as Forge.Functions.Assets's own Program.cs: the .NET
// 9+ SDK makes the compiler-generated top-level-statements Program class
// public by default, which collides with Forge.Api's own public Program
// the moment Forge.Tests references both assemblies unqualified. Nothing
// outside this assembly needs this Program type; Forge.Tests references
// this assembly only for ArtGenScanner/ArtGenOrchestrator.
internal partial class Program;

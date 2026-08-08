// docs/SPEC.md Section 10.4 gate 4's host process. Isolated-worker
// bootstrap (HostBuilder + ConfigureFunctionsWorkerDefaults), the same
// shape Azure Functions isolated-worker apps have used since the model's
// introduction — chosen over the newer FunctionsApplication.CreateBuilder
// alternative specifically because it's the longer-established, more
// widely documented form, which matters here: this environment has no
// .NET SDK to compile-check it before pushing (see
// Forge.Functions.Scan.csproj's own remarks).
using Forge.Functions.Scan;
using Forge.Infrastructure;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        services.AddForgeInfrastructure(context.Configuration);
        services.AddForgeBundleStorage(context.Configuration);
        services.AddForgeScanGate(context.Configuration);
    })
    .Build();

await host.RunAsync();

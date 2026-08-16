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

// As of the .NET 9 SDK, the compiler-generated Program class backing top-
// level statements is public by default (a deliberate change upstream,
// specifically to let WebApplicationFactory<Program> work without the
// explicit partial-class declaration Forge.Api.csproj's own Program.cs
// still carries from when that workaround was necessary). That default
// collides here: Forge.Tests references both this assembly and Forge.Api
// unqualified, and two same-named public Program types across referenced
// assemblies is CS0433, not a warning. Forcing this one back to internal
// — merging with the compiler-generated partial declaration, same
// mechanism Forge.Api's public one uses in reverse — is correct, not just
// a build-error workaround: nothing in Forge.Tests (or anywhere else)
// actually needs this Program type; it references this assembly only for
// SmokeRunGate/PendingVersionScanner (Forge.Functions.Scan.csproj's own
// doc comment).
internal partial class Program;

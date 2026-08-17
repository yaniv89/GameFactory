// docs/adr/0010 Decision 5's real, physically separate play-origin host.
// No Identity, no OpenIddict, no cookies, no ForgeDbContext — see
// Forge.Play.csproj's own remarks for why this host has none of those to
// begin with.
using Forge.Play;

var builder = WebApplication.CreateBuilder(args);
PlayApp.AddServices(builder);

var app = builder.Build();
PlayApp.MapEndpoints(app);

app.Run();

// Same CS0433 fix as Forge.Functions.Scan/Forge.Functions.Build's own
// Program.cs: the .NET 9+ SDK makes the compiler-generated top-level-
// statements Program class public by default, which collides with
// Forge.Api's own public Program the moment Forge.Tests references both
// assemblies unqualified. Forcing this one back to internal is correct,
// not a workaround — Forge.Tests never references Forge.Play.Program by
// name, only PlayApp/ServeBuildEndpoint/PlaySecurityHeaders directly
// (PlayApp.cs's own remarks on why: a real bound Kestrel server, not
// WebApplicationFactory<Program>'s in-memory TestServer).
internal partial class Program;

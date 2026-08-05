// Minimal API host. Endpoint surface (docs/SPEC.md Section 13) is built out
// starting in Milestone M5. Only a health check exists so far — everything
// else (auth, project CRUD, marketplace, publish) is scaffolded, not faked.
using Forge.Api.Security;

var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.UseForgeSecurityHeaders();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.Run();

// Exposed for WebApplicationFactory<Program> in Forge.Tests.
public partial class Program;

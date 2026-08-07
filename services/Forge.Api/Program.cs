// Minimal API host. Endpoint surface (docs/SPEC.md Section 13) is built out
// starting in Milestone M5. Only a health check and the EF Core data layer
// exist so far — auth, project CRUD, billing, marketplace, and publish are
// still scaffolded, not faked.
using Forge.Api.Security;
using Forge.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddForgeInfrastructure(builder.Configuration);

var app = builder.Build();

app.UseForgeSecurityHeaders();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.Run();

// Exposed for WebApplicationFactory<Program> in Forge.Tests.
public partial class Program;

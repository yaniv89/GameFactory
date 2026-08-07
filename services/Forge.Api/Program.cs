// Minimal API host. Endpoint surface (docs/SPEC.md Section 13) is built out
// starting in Milestone M5. Auth (Identity + OpenIddict), the EF Core data
// layer, and workspace-scoped authorization policies exist so far —
// project CRUD, billing, marketplace, and publish are still scaffolded,
// not faked.
using Forge.Api;
using Forge.Api.Authorization;
using Forge.Api.Features.Auth;
using Forge.Api.Security;
using Forge.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddForgeInfrastructure(builder.Configuration);
builder.Services.AddForgeAuth(builder.Environment.IsDevelopment());
builder.Services.AddForgeAuthorization();

var app = builder.Build();

app.UseForgeSecurityHeaders();

app.UseAuthentication();
app.UseAuthorization();
// After UseAuthorization, not between it and UseAuthentication: every
// policy here binds an explicit AuthenticationScheme (Bearer via
// OpenIddict validation, or the Identity cookie for /connect/authorize)
// rather than relying on the default scheme. HttpContext.User only gets
// updated to reflect THAT scheme's result during the authorization
// middleware's own policy-specific re-authentication — UseAuthentication
// alone only populates it from the default scheme, which would leave a
// Bearer-authenticated request looking anonymous to this middleware if
// it ran any earlier.
app.UseMiddleware<CurrentUserMiddleware>();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.MapAuthEndpoints();

await OpenIddictSeeding.SeedAsync(app);

app.Run();

// Exposed for WebApplicationFactory<Program> in Forge.Tests.
public partial class Program;

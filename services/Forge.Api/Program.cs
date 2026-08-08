// Minimal API host. Endpoint surface (docs/SPEC.md Section 13) is built out
// starting in Milestone M5. Auth (Identity + OpenIddict), the EF Core data
// layer, workspace-scoped authorization policies, Projects CRUD +
// CommitRevision, Redis-backed rate limiting, Stripe billing + plan gating,
// the registry's read surface + dependency resolution (M6 Phase 1), and
// publishing through gates 1-3 of the Section 10.4 pipeline — manifest
// validation, static analysis, dependency audit (M6 Phase 2) — exist so
// far. Gate 4 (the sandboxed smoke run) and gate 5 (the reputation queue,
// which needs Section 16.3's trust tiers, M7 scope) don't exist yet: a
// published version stays scan_status=pending, never passed, until gate 4
// lands in M6 Phase 3 — a stated gap, not a silently skipped one.
using Forge.Api;
using Forge.Api.Authorization;
using Forge.Api.Features.Auth;
using Forge.Api.Features.Billing;
using Forge.Api.Features.Projects;
using Forge.Api.Features.Registry;
using Forge.Api.RateLimiting;
using Forge.Api.Security;
using Forge.Infrastructure;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddForgeInfrastructure(builder.Configuration);
builder.Services.AddForgeAuth(builder.Environment.IsDevelopment());
builder.Services.AddForgeAuthorization();
builder.Services.AddForgeRateLimiting(builder.Configuration);
builder.Services.AddForgeBilling(builder.Configuration);
builder.Services.AddForgeRegistry();
builder.Services.AddForgeBundleStorage(builder.Configuration);

var app = builder.Build();

// IP-keyed rate limits (RateLimitKeyStrategy.IpAddress) are meaningless
// without this: every request would otherwise appear to originate from
// the load balancer itself (CLAUDE.md Section 1.5 guardrail 20 — designed
// for N replicas behind a load balancer from day one). Default
// ForwardedHeadersOptions only trusts loopback proxies; the real
// production trusted-proxy allowlist (KnownProxies/KnownNetworks) is
// deployment infrastructure that doesn't exist in this repo yet — a
// stated gap, not a silent one, tracked alongside M5 Phase 6's load test.
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor });

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
// After CurrentUserMiddleware: User-keyed rate-limit policies read
// ICurrentUser, which isn't populated any earlier (RateLimitingMiddleware's
// own doc comment).
app.UseMiddleware<RateLimitingMiddleware>();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.MapAuthEndpoints();
app.MapProjectEndpoints();
app.MapBillingEndpoints();
app.MapRegistryEndpoints();

await OpenIddictSeeding.SeedAsync(app);

app.Run();

// Exposed for WebApplicationFactory<Program> in Forge.Tests.
public partial class Program;

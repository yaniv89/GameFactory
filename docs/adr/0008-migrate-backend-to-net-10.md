# 8. Migrate the backend from .NET 8 LTS to .NET 10 LTS

Date: 2026-08-16

## Status

Accepted

## Context

CLAUDE.md Section 2.1 pins .NET 8 LTS as the backend runtime. .NET 10 (also LTS, GA November 2025) has been out for roughly nine months. The question of moving was raised directly, not discovered as an incident — there was no CVE or forcing deadline behind it, so the two things worth checking before committing were (1) whether anything in this repo's actual dependency set would block the move, and (2) whether the two riskiest-looking dependencies specifically would force a larger, less predictable change than a routine version bump.

Checked against the real repo, not assumed:

- All seven `.csproj` files were uniformly `net8.0` — no per-project skew to reconcile.
- No `global.json` pinning the SDK, no `#if NET8_0` conditional compilation, nothing else version-gated in source.
- `Microsoft.Azure.Functions.Worker`-based isolated-worker model (used by the three `Forge.Functions.*` projects) is GA on .NET 10 across all Linux/Windows hosting plans except Linux Consumption, with support running through November 2028. The projects were also confirmed already on the isolated-worker model (`OutputType=Exe` + `Microsoft.Azure.Functions.Worker`), not the legacy in-process model Microsoft is retiring November 2026 — that deprecation doesn't apply here regardless.
- `OpenIddict.AspNetCore`/`OpenIddict.EntityFrameworkCore` at the exact version already pinned (7.6.0) already multi-targets `net8.0`, `net9.0`, and `net10.0` — no OpenIddict version change is needed at all. This mattered more than a typical dependency check: the httpOnly-refresh-cookie work landed in this same session and required tracing real, undocumented OpenIddict internal-pipeline behavior (`ProcessSignInContext` short-circuiting before a custom `SetOrder(int.MaxValue)` handler runs; `ApplyTokenResponseContext` not firing at all under `EnableTokenEndpointPassthrough()`) to get right. That behavior is a property of the OpenIddict *version*, not the .NET runtime version — since the version isn't changing, that custom plumbing isn't at risk of the same kind of silent breakage a forced OpenIddict major bump would have carried.

With both real unknowns resolved as low-risk, the move was verified directly rather than left as a plan: a .NET 10 SDK was installed locally (`apt-get install dotnet-sdk-10.0`, coexisting with the already-installed 8.0 SDK), the full solution was rebuilt clean, and `Forge.Api` was run against the same real local Postgres/Redis this session had already used to verify the refresh-cookie work — a full signup → login → PKCE authorize → token exchange round trip (including the httpOnly-cookie middleware) passed against the real .NET 10 runtime, not just a compile check.

That verification build did surface one real, unpredicted issue: `services/Forge.Tests/Forge.Tests.csproj` failed with `CS0433` — the `Program` type existed in both `Forge.Api` and `Forge.Functions.Scan`. Root cause, confirmed by reflecting on the actual compiled `Forge.Functions.Scan.dll` rather than guessed: as of the .NET 9 SDK, the compiler-generated class backing top-level statements (`Program.cs`'s implicit entry-point class) is `public` by default, a deliberate upstream change specifically so `WebApplicationFactory<Program>` works without the explicit `public partial class Program;` marker `Forge.Api`'s own `Program.cs` still carries from when that marker was necessary. `Forge.Functions.Scan`'s `Program.cs` picked up the same new default, and since `Forge.Tests` references both assemblies unqualified, two identically-named public types across referenced assemblies is a hard compile error, not a warning. Confirmed this is genuinely new (not a latent pre-existing bug) by building the identical, unmodified source on the .NET 8 SDK via `git stash` — zero errors there. Fixed by adding an explicit `internal partial class Program;` to `Forge.Functions.Scan/Program.cs`, forcing that project's entry-point class back to internal (mirroring, in reverse, the exact mechanism `Forge.Api` already uses to force its own public) — correct on the merits, not just a build-error workaround, since nothing outside `Forge.Functions.Scan` actually needs that type; `Forge.Tests` references the assembly only for `SmokeRunGate`/`PendingVersionScanner`.

## Decision

1. **Bump all seven `.csproj` files' `TargetFramework` from `net8.0` to `net10.0`.**
2. **Bump every package versioned in lockstep with the .NET major version in this repo** to its `10.x` line: `Microsoft.EntityFrameworkCore`(`.Design`) 10.0.11, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3, `EFCore.NamingConventions` 10.0.1, `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 10.0.11, `Microsoft.AspNetCore.SignalR.Client`/`.StackExchangeRedis` 10.0.11, `Microsoft.AspNetCore.Mvc.Testing` 10.0.11. Also bumped `Microsoft.Azure.Functions.Worker.Sdk` 2.0.7 → 2.1.0 (latest stable) while in the neighborhood — confirmed this was not itself the cause of the `Program`-ambiguity build error (isolated by testing with the old Worker.Sdk version still in place before identifying the real cause above).
3. **No version change to `OpenIddict.AspNetCore`/`OpenIddict.EntityFrameworkCore` (stays 7.6.0)** — already supports `net10.0`.
4. **Add `internal partial class Program;` to `Forge.Functions.Scan/Program.cs`**, restoring its entry-point type to internal visibility now that the SDK's own default changed, resolving the `CS0433` conflict with `Forge.Api`'s explicitly-public `Program`.
5. **Bump CI's four `dotnet-version: "8.0.x"` pins** (`.github/workflows/ci.yml`) to `"10.0.x"`.
6. **Update CLAUDE.md Section 2.1**: "Runtime | .NET 10 LTS" and "Jobs | Azure Functions (isolated worker, .NET 10)".

## Consequences

- Every CI job that builds or tests the .NET solution now provisions the .NET 10 SDK instead of 8.0.
- `dotnet ef` tooling, local dev instructions, and anything else assuming a `net8.0` output path (`bin/Release/net8.0/...`) moves to `net10.0` — checked README.md and docs/SPEC.md for stale `net8.0`/".NET 8" references as part of landing this.
- The `Program`-class-visibility default is now a documented trap for this repo specifically: any *future* new `Microsoft.NET.Sdk` "Exe" project (another Azure Function, a CLI tool) that gets referenced by `Forge.Tests` needs the same `internal partial class Program;` guard from day one, not just Forge.Functions.Scan — otherwise it silently reproduces the same CS0433 the moment `Forge.Tests` references it.
- This does not commit to tracking every future .NET release the same way — a later move to .NET 11 (already in preview at time of writing) or beyond is a separate decision with its own compatibility check, following the same "verify against the real repo, don't assume" discipline this ADR used, not implied by this one.

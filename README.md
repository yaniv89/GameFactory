# Forge

Forge is a browser-based platform where non-programmers assemble publishable 2D top-down RPGs from swappable art packs and drag-in behavior modules, and where third-party developers sell those modules through a first-party marketplace. Think WordPress, but for games.

## Start here

- **[`CLAUDE.md`](./CLAUDE.md)** — the standing operating contract for this repository: guardrails, tech stack, milestone plan, and definition of done. Read it before writing any code.
- **[`docs/SPEC.md`](./docs/SPEC.md)** — the full technical and product specification: domain model, system architecture, data model, Module API, security model, Art Pack system, and roadmap.
- **[`docs/security/THREAT-MODEL.md`](./docs/security/THREAT-MODEL.md)** — the threat model and trust boundaries.
- **[`docs/adr/`](./docs/adr/)** — architecture decision records.

## Repository layout

```
forge/
├── packages/        # JS/TS workspaces (pnpm) — engine, editor, first-party modules
├── services/         # .NET solution — API, domain, infrastructure, build/scan/asset Functions
├── docs/             # specification, ADRs, security docs
├── fixtures/         # golden-file projects and benign/hostile test modules
└── tools/            # performance benchmark harness, security tooling
```

## Status

Milestones M0–M7 (see `CLAUDE.md` Section 8) are implemented, tested, and merged — engine, sandbox, Module API, editor shell, backend/persistence, registry/publish/Art Packs, and collaboration/marketplace. The editor SPA is now wired end to end to `Forge.Api` (real sign-up/sign-in, project list/create, server-persisted saves, live presence) — see "Running the full stack locally" below to try it. The refresh token lives in an `httpOnly` cookie, not the `/connect/token` JSON body (CLAUDE.md Section 4.7's target design). The standalone player reacts to a runtime `scene:changed` transition (a module's own `ctx.scene.transitionTo()`, or a native system) by swapping the current scene's tiles and NPC entities and repositioning the player, closing the last stated gap in this list.

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 10 (`corepack enable` or install per `packageManager` in `package.json`)
- .NET 10 SDK
- Docker (or another way to run Postgres 16, Redis 7, and an Azurite-compatible blob emulator) for the full stack below

Docker is also what 165 of `services/Forge.Tests`' 257 tests need — every suite that touches real Postgres/Redis/Azurite through Testcontainers (cross-tenant authorization, the load tests, registry/publish gates, billing, play services). Without a running daemon they fail with `DockerUnavailableException` rather than skipping, so `dotnet test` is only meaningful with Docker up.

`.claude/hooks/bootstrap-docker.sh` (wired as a `SessionStart` hook in `.claude/settings.json`) handles that automatically **in the Claude Code cloud sandbox only**, where the daemon isn't started for you and the egress policy blocks Docker Hub's CDN. It is deliberately a hard no-op everywhere else — it exits without doing anything if Docker already works, if you aren't root, or if the sandbox's agent proxy isn't present, and it never modifies an existing `/etc/docker/daemon.json`. On your own machine it will never touch your Docker setup; start Docker however you normally do.

## Running the full stack locally

Four processes: Postgres/Redis/Azurite/Mailpit (`docker-compose.yml`), `Forge.Api`, and the editor SPA. The editor's Vite dev server proxies `/api`, `/connect`, `/health`, and `/hubs` to `Forge.Api` (`packages/editor/vite.config.ts`) so the browser sees one origin end to end — that's deliberate, not incidental: the Identity login cookie `Forge.Infrastructure/DependencyInjection.cs` sets is `SameSite=Strict`, which only survives a same-origin request. Do not run the editor against a different-origin API without also fixing that proxy; a cross-origin CORS setup would silently break sign-in instead.

1. **Infra** — from the repo root:
   ```sh
   docker compose up -d
   ```
   Brings up Postgres 16 on `5432`, Redis 7 on `6379`, an Azurite blob/table/queue emulator on `10000`–`10002`, and Mailpit (a local SMTP catcher) on `1025`/`8025` — matching `services/Forge.Tests/ForgeWebApplicationFactory.cs`'s own Testcontainers setup and `appsettings.json`'s default connection strings, no extra configuration needed for local dev.

2. **API** — from `services/Forge.Api/`:
   ```sh
   dotnet run --urls http://localhost:5080
   ```
   `5080` is the port `vite.config.ts`'s dev proxy is pinned to (`API_DEV_PORT`) — running the API on a different port breaks the proxy, not the API. In Development, `Program.cs` applies the real, checked-in EF Core migrations (`services/Forge.Infrastructure/Persistence/Migrations/`) on startup — no separate `dotnet ef database update` step needed against the empty Postgres database from step 1. That auto-migrate is deliberately Development-only: a real deployment runs migrations as an explicit step before new instances start, not implicitly inside every instance's own boot (see `Program.cs`'s own comment on why — it's about not racing N replicas, not about migrations being missing).

   **Email** — `appsettings.Development.json`'s `Smtp` section points `Forge.Infrastructure.Email.SmtpEmailSender` at Mailpit, so signup verification and password-reset mail are real, deliverable messages, not just a log line — open **http://localhost:8025** to read them. Nothing in that file is a secret (Mailpit takes no auth).

   **Stripe** — Checkout/Portal, marketplace purchases, and the paid-module publish gate need real Stripe **test-mode** keys (never live keys for local dev). `appsettings.json`'s `Stripe` section is an inert placeholder — never put a real key there, since it's committed. Instead, from `services/Forge.Api/` (already has a `UserSecretsId`, `dotnet user-secrets init` already run):
   ```sh
   dotnet user-secrets set "Stripe:SecretKey" "sk_test_..."
   dotnet user-secrets set "Stripe:WebhookSecret" "whsec_..."       # from `stripe listen --forward-to localhost:5080/api/v1/webhooks/stripe`
   dotnet user-secrets set "Stripe:ProPriceId" "price_..."          # a real test-mode recurring Price from your Stripe dashboard
   dotnet user-secrets set "Stripe:StudioPriceId" "price_..."
   ```
   User secrets live outside the repo (`~/.microsoft/usersecrets/<UserSecretsId>/secrets.json`) and are layered over `appsettings.json` automatically in Development — no code change needed. Get test-mode keys from your own Stripe dashboard (free, no real account/business needed for test mode); run `stripe listen` alongside `Forge.Api` to forward webhook events to the endpoint above and print the matching `whsec_...` secret.

3. **Editor** — from `packages/editor/`:
   ```sh
   pnpm install
   pnpm dev
   ```
   Open `http://localhost:5190` (the port `OpenIddictSeeding.cs` seeds `forge-editor`'s OAuth redirect URI against, and what `playwright.config.ts` expects). Sign up for an account, sign in (Authorization Code + PKCE against the API's OpenIddict server, `packages/editor/src/auth/authClient.ts`), and you land on your project list (`GET /api/v1/me`'s workspace, created automatically at signup) — create a project and the editor shell opens against it, with saves committed as real revisions (`POST /api/v1/projects/{id}/revisions`) rather than only `localStorage`.

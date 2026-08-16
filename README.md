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

Milestones M0–M7 (see `CLAUDE.md` Section 8) are implemented, tested, and merged — engine, sandbox, Module API, editor shell, backend/persistence, registry/publish/Art Packs, and collaboration/marketplace. The editor SPA is now wired end to end to `Forge.Api` (real sign-up/sign-in, project list/create, server-persisted saves, live presence) — see "Running the full stack locally" below to try it. The refresh token lives in an `httpOnly` cookie, not the `/connect/token` JSON body (CLAUDE.md Section 4.7's target design). One stated, deliberate gap remains, tracked rather than silently assumed done: the player app does not yet react to `scene:changed` by swapping tile/entity content on a runtime scene transition.

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 10 (`corepack enable` or install per `packageManager` in `package.json`)
- .NET 8 SDK
- Docker (or another way to run Postgres 16, Redis 7, and an Azurite-compatible blob emulator) for the full stack below

## Running the full stack locally

Three processes: Postgres/Redis/Azurite (`docker-compose.yml`), `Forge.Api`, and the editor SPA. The editor's Vite dev server proxies `/api`, `/connect`, `/health`, and `/hubs` to `Forge.Api` (`packages/editor/vite.config.ts`) so the browser sees one origin end to end — that's deliberate, not incidental: the Identity login cookie `Forge.Infrastructure/DependencyInjection.cs` sets is `SameSite=Strict`, which only survives a same-origin request. Do not run the editor against a different-origin API without also fixing that proxy; a cross-origin CORS setup would silently break sign-in instead.

1. **Infra** — from the repo root:
   ```sh
   docker compose up -d
   ```
   Brings up Postgres 16 on `5432`, Redis 7 on `6379`, and an Azurite blob/table/queue emulator on `10000`–`10002`, matching `services/Forge.Tests/ForgeWebApplicationFactory.cs`'s own Testcontainers setup and `appsettings.json`'s default connection strings — no extra configuration needed for local dev.

2. **API** — from `services/Forge.Api/`:
   ```sh
   dotnet run --urls http://localhost:5080
   ```
   `5080` is the port `vite.config.ts`'s dev proxy is pinned to (`API_DEV_PORT`) — running the API on a different port breaks the proxy, not the API. In Development, `Program.cs` applies the real, checked-in EF Core migrations (`services/Forge.Infrastructure/Persistence/Migrations/`) on startup — no separate `dotnet ef database update` step needed against the empty Postgres database from step 1. That auto-migrate is deliberately Development-only: a real deployment runs migrations as an explicit step before new instances start, not implicitly inside every instance's own boot (see `Program.cs`'s own comment on why — it's about not racing N replicas, not about migrations being missing). Payments and email are stubbed via the placeholder values already in `appsettings.json` (`Stripe`, `PlayServices` sections); nothing there is a real secret, so no `.env` file is required to sign up, sign in, or create a project. Stripe Checkout/Portal and outbound email will not work without swapping those placeholders for real keys.

3. **Editor** — from `packages/editor/`:
   ```sh
   pnpm install
   pnpm dev
   ```
   Open `http://localhost:5190` (the port `OpenIddictSeeding.cs` seeds `forge-editor`'s OAuth redirect URI against, and what `playwright.config.ts` expects). Sign up for an account, sign in (Authorization Code + PKCE against the API's OpenIddict server, `packages/editor/src/auth/authClient.ts`), and you land on your project list (`GET /api/v1/me`'s workspace, created automatically at signup) — create a project and the editor shell opens against it, with saves committed as real revisions (`POST /api/v1/projects/{id}/revisions`) rather than only `localStorage`.

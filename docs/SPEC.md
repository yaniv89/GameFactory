# Forge: A WordPress-Model Platform for Game Creation
**Technical and Product Specification**
Version 0.2 (Draft)
Date: 2026-08-05
---
## Document Control
| Field | Value |
|---|---|
| Status | Draft for review |
| Scope decision | 2D top-down RPG / adventure as beachhead genre |
| Primary stack | .NET 8, React 18, TypeScript 5, PostgreSQL 16, Azure |
| Codename | Forge |
**Reading order:** Sections 1 to 4 define what is being built and why. Sections 5 to 11 are the core technical architecture. Sections 12 to 17 cover surrounding systems. Sections 18 to 22 cover operational concerns, phasing and risk.
---
## 1. Product Thesis
### 1.1 What actually made WordPress win
WordPress did not win because it made websites easy to build. Squarespace and Wix are easier. WordPress won on four structural properties:
1. **An extension ecosystem with a stable contract.** Third parties could add functionality without forking core. The plugin API changed slowly and broke rarely.
2. **Separation of content from presentation.** Themes could be swapped without destroying the content underneath.
3. **Ownership and portability.** Users could export, self-host, and move. This removed the fear of building on someone else's platform.
4. **An economy.** Plugin and theme authors made real money, which is why 60,000+ plugins exist. The ecosystem was self-funding.
A game platform that copies only the visual editor copies the least important part.
### 1.2 The Forge thesis
> Forge is a browser-based platform where a non-programmer can assemble a complete, publishable 2D RPG from swappable art packs and drag-in behavior modules, where third-party developers can sell those modules through a first-party marketplace, and where the resulting game is a portable, exportable artifact the creator fully owns.
### 1.3 Non-goals
Explicitly out of scope for v1. Stating these prevents scope creep from killing the project.
| Non-goal | Rationale |
|---|---|
| 3D games | Order of magnitude more asset pipeline, physics and performance work |
| Native desktop/console export | Web and PWA first. Native wrappers are a phase 3 concern |
| A general-purpose game engine | Generality is the failure mode. Godot already exists and is free |
| Real-time competitive multiplayer | Netcode determinism is a multi-year problem on its own |
| An asset creation suite | Integrate with Aseprite, Tiled, LDtk. Do not rebuild them |
| Server-side plugin execution | Deliberate architectural rejection. See Section 10 |
### 1.4 Target users
| Persona | Description | Primary need |
|---|---|---|
| **Creator** (80% of users) | Hobbyist or indie, minimal coding ability, has a story or game idea | Assemble a game without writing code |
| **Extender** (15%) | Comfortable with JavaScript, wants custom mechanics | Escape hatch into real code without leaving the platform |
| **Author** (5%) | Professional plugin or asset pack developer | A monetizable distribution channel with a stable API |
The Author persona is the smallest group and the most important one. Without Authors, the platform is just a mediocre editor. Every architectural decision should be weighted toward Author success.
---
## 2. Scope Decision: Why Top-Down 2D RPG
### 2.1 Options considered
| Genre | Ecosystem evidence | Technical scope | Verdict |
|---|---|---|---|
| Visual novel | Ren'Py has a large creator base but a weak plugin culture | Very small | Ceiling too low. Little room for a plugin economy |
| Idle / incremental | Highly data-driven, monetizes well | Small | Strong phase 2 candidate. Weak visual demo appeal |
| **Top-down 2D RPG** | **RPG Maker MZ plugin scene is the closest existing analog to WordPress plugins** | **Medium** | **Selected** |
| Match-3 / hypercasual | Saturated, low creator loyalty | Small | Commodity market. No ecosystem moat |
| Platformer | Requires tight physics tuning, hard to make feel good generically | Medium-high | Physics feel is genre-defining and resists templating |
### 2.2 Rationale for the selection
- **Proven plugin demand.** The RPG Maker plugin community demonstrates that creators in this genre will pay for behavior modules. That is the exact behavior Forge needs.
- **Templatable structure.** RPGs decompose cleanly into maps, entities, dialogue, items, stats and battles. Each decomposes into a plugin surface.
- **Art packs are a natural theme system.** Tilesets and sprite sheets swap cleanly if the platform enforces grid and anchor conventions. This gives you a real "theme" concept, not a fake one.
- **Existing incumbent has exploitable weaknesses.** RPG Maker is desktop-only, has no collaboration, no cloud, a per-seat license, and clunky web export.
### 2.3 Genre expansion path
Forge should expand along the axis of **shared systems**, not shared aesthetics.
```
Phase 1: Top-down RPG / adventure
            |
            +-- shares: tilemaps, entities, dialogue, inventory
            v
Phase 2: Simulation / management  (farming, shop sims, dating sims)
            |
            +-- shares: entities, stats, progression, save system
            v
Phase 3: Idle / incremental       (data-driven, minimal rendering)
```
Each phase reuses the entity, plugin, save and publish systems. Only the rendering and input layers differ.
---
## 3. The WordPress Mapping
This table is the platform's conceptual spine. Every ambiguous product decision should be resolved by asking "what does WordPress do here."
| WordPress concept | Forge equivalent | Notes |
|---|---|---|
| Site | **Project** | One game. Owns all content and configuration |
| Post / Page | **Scene** | A map, a battle arena, a menu screen |
| Custom post type | **Entity Type** | Character, item, enemy, quest. User-definable |
| Custom field / meta | **Component** | Typed data attached to an entity |
| Theme | **Art Pack** | Tilesets, sprites, UI skin, audio, font. Swappable |
| Child theme | **Pack Override** | Per-project asset replacements layered over a pack |
| Plugin | **Module** | Adds mechanics, editor panels, runtime systems |
| Hook / filter | **Event Bus + Interceptors** | The Module extension contract. See Section 9 |
| Shortcode | **Script Block** | Reusable logic snippet placed in dialogue or events |
| WP-Admin | **Editor** | The browser IDE |
| Gutenberg | **Scene Canvas + Node Graph** | Visual authoring surfaces |
| wp-config.php | **project.json** | Project manifest |
| Database | **Project Document Store** | Versioned JSON, see Section 7 |
| WP.org repository | **Forge Marketplace** | Free and paid Modules and Art Packs |
| WP-CLI | **forge CLI** | Local dev, CI, bulk operations |
| Multisite | **Studio Workspace** | Shared org with multiple projects and seats |
| Self-hosting | **Export to static bundle** | Non-negotiable. This is the trust anchor |
### 3.1 The critical inversion
WordPress plugins execute **server-side with full trust**. This is the source of most WordPress security incidents.
Forge Modules execute **client-side in the player's browser, inside a sandbox**. The Forge server never executes third-party code in a trusted context. This is a deliberate and load-bearing decision covered in Section 10.
---
## 4. Domain Model
### 4.1 Entity hierarchy
```
Workspace (org / studio)
 └── Project (a game)
      ├── ProjectManifest      (metadata, dependencies, settings)
      ├── Scene[]              (maps, menus, battle arenas)
      │    ├── TilemapLayer[]
      │    ├── EntityInstance[]
      │    └── TriggerRegion[]
      ├── EntityDefinition[]   (blueprints: "Goblin", "Health Potion")
      │    └── ComponentValue[]
      ├── DataTable[]          (items, skills, dialogue, loot tables)
      ├── ScriptGraph[]        (visual logic: quests, cutscenes, events)
      ├── AssetRef[]           (pointers into Art Packs or project uploads)
      └── Dependency[]         (Module and Art Pack references with semver)
```
### 4.2 Entity-Component model
Forge uses a **data-oriented Entity Component System** at runtime. This is the single most important technical choice for Module extensibility, because it lets a third-party Module add behavior to entities it did not create.
- **Entity**: an opaque integer ID. Holds no data and no behavior.
- **Component**: a plain typed data struct. Declared by core or by a Module.
- **System**: a function that runs each tick over all entities matching a component query.
A Module that adds a farming mechanic declares a `Crop` component and a `CropGrowthSystem`. It never needs to modify core code, and it composes with any other Module that did the same. This is the structural equivalent of a WordPress plugin adding a custom post type.
⚠ **Design constraint:** components must be serializable to JSON with no functions, no class instances and no circular references. This is required for save files, undo history, collaborative editing and hot reload. Enforce it at the schema level, not by convention.
### 4.3 Core component library
Core ships a minimal set. Everything else is a Module.
| Component | Fields | Owner |
|---|---|---|
| `Transform` | `x, y, z, rotation, scaleX, scaleY` | core |
| `Sprite` | `assetId, frame, anchorX, anchorY, tint, opacity` | core |
| `Animator` | `clipId, playing, speed, loop, elapsed` | core |
| `Collider` | `shape, width, height, offsetX, offsetY, isTrigger, layer` | core |
| `Velocity` | `vx, vy, maxSpeed, friction` | core |
| `PlayerControlled` | `inputMapId` | core |
| `Interactable` | `promptText, range, graphId` | core |
| `Stats` | `values: Record<string, number>` | core |
| `Inventory` | `slots: InventorySlot[], capacity` | `@forge/inventory` module |
| `DialogueSource` | `graphId, hasBeenSpokenTo` | `@forge/dialogue` module |
Note that `Inventory` and `Dialogue` are Modules, not core. They are first-party Modules maintained by Forge, but they use the exact same public API a third party would use. **This is the discipline that keeps the plugin API honest.** If first-party features need private APIs, the public API is not good enough.
---
## 5. System Architecture
### 5.1 High-level topology
```
┌────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                        │
│                                                                │
│  ┌──────────────────┐         ┌───────────────────────────┐    │
│  │  Forge Editor    │         │  Forge Runtime (Preview)  │    │
│  │  React 18 + TS   │◄───────►│  ECS + PixiJS v8          │    │
│  │  Zustand, Yjs    │  hot    │  in <iframe> sandbox      │    │
│  └────────┬─────────┘  reload └─────────────┬─────────────┘    │
│           │                                 │                  │
│           │                    ┌────────────▼──────────────┐   │
│           │                    │  Module Sandbox           │   │
│           │                    │  QuickJS-WASM in Worker   │   │
│           │                    └───────────────────────────┘   │
└───────────┼────────────────────────────────────────────────────┘
            │ HTTPS / WSS
┌───────────▼────────────────────────────────────────────────────┐
│                      API LAYER (.NET 8)                        │
│  Minimal API + SignalR hub                                     │
│  ┌──────────┬───────────┬──────────┬──────────┬─────────────┐  │
│  │ Projects │ Marketplace│ Assets  │ Publish  │ Collab hub  │  │
│  └──────────┴───────────┴──────────┴──────────┴─────────────┘  │
└───────────┬───────────────────────────┬────────────────────────┘
            │                           │
┌───────────▼─────────────┐  ┌──────────▼──────────────────────┐
│  PostgreSQL 16          │  │  Azure Functions (build workers)│
│  projects, users,       │  │  - bundle + minify              │
│  marketplace, licenses  │  │  - texture atlas packing        │
│  JSONB project docs     │  │  - static export zip            │
└─────────────────────────┘  │  - Module security scan         │
┌─────────────────────────┐  └──────────┬──────────────────────┘
│  Redis                  │             │
│  presence, job queue,   │  ┌──────────▼──────────────────────┐
│  rate limits, sessions, │  │  Azure Blob Storage + CDN       │
│  SignalR backplane      │  │  assets, packs, published games │
└─────────────────────────┘  └─────────────────────────────────┘
┌─────────────────────────┐
│  Azure Table Storage    │
│  play telemetry,        │
│  leaderboards, cloud    │
│  saves (high write vol) │
└─────────────────────────┘
```
### 5.2 Service responsibilities
| Service | Responsibility | Technology |
|---|---|---|
| **Identity** | Auth, sessions, workspace membership, seats | .NET 8, ASP.NET Core Identity + OIDC |
| **Project** | CRUD on project documents, version history, locking | .NET 8 Minimal API, EF Core 8, PostgreSQL JSONB |
| **Collab** | Real-time multi-user editing, presence, CRDT relay | SignalR hub, Yjs server-side awareness |
| **Asset** | Upload, validation, transcode, CDN publish | .NET 8 + Azure Functions, Blob Storage |
| **Marketplace** | Listings, purchases, licensing, payouts, reviews | .NET 8, PostgreSQL, Stripe Connect |
| **Registry** | Module and Pack versions, semver resolution, integrity hashes | .NET 8, PostgreSQL, Blob |
| **Build** | Bundle, atlas, minify, export, sign | Azure Functions (isolated worker), Node sidecar |
| **Play** | Serve published games, cloud saves, leaderboards, telemetry | .NET 8 Minimal API, Azure Table Storage, CDN |
### 5.3 Why this split
- The **editor is a pure SPA**. It talks to the API and never requires server-rendered pages. This keeps the door open for a fully offline desktop build later using the same codebase.
- **Build work is offloaded to Functions** because bundling is bursty, CPU-bound and untrusted. It must never run in the API process. ⚠ Build workers process third-party Module source. They run with no network egress except to Blob Storage, and with a hard CPU and memory cap.
- **Azure Table Storage handles play telemetry and cloud saves** because write volume from published games is orders of magnitude higher than editor traffic, the access pattern is a simple partition+row key lookup, and it must not contend with the transactional database.
### 5.4 Deployment
| Environment | Purpose | Notes |
|---|---|---|
| `local` | Docker Compose: API, Postgres, Redis, Azurite | Full stack on a laptop |
| `preview` | Per-PR ephemeral environment | Auto-torn down after merge |
| `staging` | Pre-production, seeded with anonymized data | Marketplace in Stripe test mode |
| `production` | Multi-region CDN for published games, single-region API | Published games must be geo-fast. The editor can tolerate latency |
### 5.5 Scalability architecture
Scalability is a day-one architectural constraint, not a phase-4 optimization pass. The three tiers that see load — the API, the Collab hub, and the Play surface — scale differently, and each has a specific mechanism, not just "add instances."
**API tier: stateless, horizontally scaled behind a load balancer.**
- No in-process session, cache-as-source-of-truth, or in-memory rate-limit counter. Section 4.5's workspace-role cache is a read-through cache over Redis with a short TTL, not a per-instance `IMemoryCache` used as the only copy — an `IMemoryCache` layer in front of Redis is fine as an L1, but Redis (or Postgres) is always the durable source.
- Rate limiting (Section 4.8) is centralized in Redis (sliding window or token bucket keyed by user/IP/workspace), never per-instance in-memory counters, or a creator on instance A could bypass a limit enforced only on instance B.
- Autoscale on CPU and request queue depth. Target: an added instance under load reaches steady-state serving within 60 seconds (no per-instance warm cache to rebuild that blocks readiness).
**Collab hub: SignalR requires a backplane the moment there is more than one instance.**
- A client connected to hub instance A and a client connected to hub instance B must still see each other's presence and CRDT updates. Azure SignalR Service (managed) is the default; a self-hosted Redis backplane is the fallback for local/on-prem. This is called out explicitly because it is the one piece of this architecture that cannot be bolted on after the fact without a hub redesign — plan the connection and group model around it from M5/M7, not after a scaling incident.
- Presence and Yjs awareness state live in the backplane, not in a hub instance's memory, so a client's reconnect after an instance recycle does not lose group membership.
**Database: connection pooling and read/write separation.**
- Npgsql pooling (or PgBouncer in front of Postgres) sized so `pool_size × api_instance_count` stays under Postgres `max_connections` with headroom for migrations and admin access. This is a concrete number to compute per environment, not an assumption.
- Dapper reporting queries (marketplace search, analytics rollups) target a read replica connection string. EF Core writes always target the primary. A query that can tolerate replica lag goes on the replica; a query in the authorization or payment path never does.
- Every new query ships with the index that backs it (Section 1.5, guardrail 19), verified with `EXPLAIN ANALYZE` in the PR, because an unindexed query is the single most common way a "scalable" architecture stops scaling.
**Play surface: the CDN and Table Storage carry the load, not the API.**
- Published games are static assets served from `cdn.forge.dev`; the API is only in the hot path for cloud saves, leaderboards, and telemetry — all Table Storage, partitioned by `buildId` (Section 6.3), so player-facing write volume scales horizontally by partition and never contends with the editor's transactional database.
- `engine.{hash}.js` is content-hashed on the engine version, not the project (Section 15.2), so it is a shared, warm CDN cache entry across every game on the platform rather than a per-project cold fetch.
**Build workers: scale by queue depth, not by pre-provisioned capacity.**
- Azure Functions consumption or premium plan, autoscaled on queue length. Untrusted-code isolation guarantees (Section 5.3, Section 10.4) hold regardless of instance count: every job gets a fresh container, zero network egress except Blob Storage, a hard CPU/memory/time cap.
⚠ **What this means in practice for every PR:** if a change adds state to an API process, adds a per-instance-only cache used as a system of record, adds a SignalR group operation that assumes a single hub instance, or adds a query without an index, it fails review under Section 1.5 regardless of whether it "works" in a single-instance dev environment. Concrete enforced numbers are in Section 18.4.
---
## 6. Data Model
### 6.1 Storage strategy
A hybrid model. Relational tables for anything queried, joined or transacted. JSONB for the project document tree.
**Rationale:** the project document is deeply nested, schema-flexible because Modules define their own components, and almost always read as a whole. Normalizing it into tables would create a join nightmare and make Module-defined data impossible to model. But marketplace listings, licenses, purchases and users are relational data with real integrity constraints, so they get real tables.
### 6.2 Core schema
```sql
-- PostgreSQL
-- Core identity, workspace and project tables for Forge
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- ─────────────────────────────────────────────────────────────
-- Identity and workspaces
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    stripe_account  TEXT,                 -- for Authors receiving payouts
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'free',   -- free | pro | studio
    seat_limit      INT  NOT NULL DEFAULT 1,
    storage_quota_mb INT NOT NULL DEFAULT 500,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE TABLE workspace_members (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,        -- owner | admin | editor | viewer
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ix_workspace_members_user ON workspace_members(user_id);
-- ─────────────────────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────────────────────
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    genre_template  TEXT NOT NULL DEFAULT 'topdown-rpg',
    engine_version  TEXT NOT NULL,        -- semver of Forge runtime
    visibility      TEXT NOT NULL DEFAULT 'private',  -- private | unlisted | public
    head_revision   BIGINT,               -- FK applied after project_revisions exists
    cover_asset_id  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (workspace_id, slug)
);
-- Append-only revision log. The document tree lives here, not in `projects`.
CREATE TABLE project_revisions (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id       BIGINT REFERENCES project_revisions(id),
    author_id       UUID REFERENCES users(id),
    label           TEXT,                 -- user-supplied checkpoint name
    doc             JSONB NOT NULL,       -- full ProjectDocument, see Section 7
    doc_hash        BYTEA NOT NULL,       -- sha256, for dedupe and integrity
    size_bytes      INT NOT NULL,
    is_checkpoint   BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_revisions_project_created
    ON project_revisions(project_id, created_at DESC);
ALTER TABLE projects
    ADD CONSTRAINT fk_projects_head
    FOREIGN KEY (head_revision) REFERENCES project_revisions(id);
-- ⚠ Full-document revisions are storage-expensive. Retention policy:
--   keep every revision for 7 days, then thin to hourly for 30 days,
--   then keep only user-labelled checkpoints. Enforced by a nightly job.
-- ─────────────────────────────────────────────────────────────
-- Registry: Modules and Art Packs
-- ─────────────────────────────────────────────────────────────
CREATE TABLE packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,   -- e.g. '@acme/farming'
    kind            TEXT NOT NULL,          -- module | artpack | template
    author_user_id  UUID NOT NULL REFERENCES users(id),
    display_name    TEXT NOT NULL,
    summary         TEXT NOT NULL,
    readme_md       TEXT,
    homepage_url    TEXT,
    license_spdx    TEXT NOT NULL,
    is_deprecated   BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_packages_search
    ON packages USING gin (display_name gin_trgm_ops, summary gin_trgm_ops);
CREATE TABLE package_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id      UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    version         TEXT NOT NULL,          -- strict semver
    engine_range    TEXT NOT NULL,          -- e.g. '>=2.1.0 <3.0.0'
    manifest        JSONB NOT NULL,         -- see Section 9.2
    bundle_url      TEXT NOT NULL,          -- immutable CDN path
    bundle_sha256   BYTEA NOT NULL,
    size_bytes      INT NOT NULL,
    scan_status     TEXT NOT NULL DEFAULT 'pending', -- pending|passed|flagged|blocked
    scan_report     JSONB,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    yanked_at       TIMESTAMPTZ,
    yank_reason     TEXT,
    UNIQUE (package_id, version)
);
CREATE INDEX ix_package_versions_pkg ON package_versions(package_id, published_at DESC);
-- ⚠ Published versions are IMMUTABLE. A version may be yanked (hidden from
-- new installs) but never mutated. Existing projects pinned to a yanked
-- version continue to resolve it. This is the npm model and it is correct.
CREATE TABLE package_dependencies (
    version_id      UUID NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
    depends_on_name TEXT NOT NULL,
    version_range   TEXT NOT NULL,
    is_optional     BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (version_id, depends_on_name)
);
-- ─────────────────────────────────────────────────────────────
-- Commerce
-- ─────────────────────────────────────────────────────────────
CREATE TABLE listings (
    package_id      UUID PRIMARY KEY REFERENCES packages(id) ON DELETE CASCADE,
    pricing_model   TEXT NOT NULL,          -- free | one_time | subscription
    price_cents     INT  NOT NULL DEFAULT 0,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    revenue_share_bps INT NOT NULL DEFAULT 8000,  -- 80% to author
    is_listed       BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT ck_price CHECK (
        (pricing_model = 'free' AND price_cents = 0) OR
        (pricing_model <> 'free' AND price_cents > 0)
    )
);
CREATE TABLE licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id      UUID NOT NULL REFERENCES packages(id),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    granted_via     TEXT NOT NULL,          -- purchase | bundle | gift | trial
    purchase_id     UUID,
    expires_at      TIMESTAMPTZ,            -- NULL = perpetual
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    UNIQUE (package_id, workspace_id)
);
CREATE INDEX ix_licenses_workspace ON licenses(workspace_id) WHERE revoked_at IS NULL;
CREATE TABLE purchases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id),
    buyer_user_id       UUID NOT NULL REFERENCES users(id),
    package_id          UUID NOT NULL REFERENCES packages(id),
    amount_cents        INT NOT NULL,
    currency            CHAR(3) NOT NULL,
    author_share_cents  INT NOT NULL,
    stripe_payment_intent TEXT NOT NULL UNIQUE,
    status              TEXT NOT NULL,      -- pending|succeeded|refunded|disputed
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ─────────────────────────────────────────────────────────────
-- Assets
-- ─────────────────────────────────────────────────────────────
CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = shared
    kind            TEXT NOT NULL,          -- image|audio|font|tileset|spritesheet|data
    original_name   TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    blob_path       TEXT NOT NULL,
    sha256          BYTEA NOT NULL,
    size_bytes      BIGINT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',  -- dims, frame data, duration
    derived_from    UUID REFERENCES assets(id),   -- transcoded variants
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_assets_dedupe
    ON assets(workspace_id, sha256) WHERE deleted_at IS NULL;
-- ─────────────────────────────────────────────────────────────
-- Publishing
-- ─────────────────────────────────────────────────────────────
CREATE TABLE published_builds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id     BIGINT NOT NULL REFERENCES project_revisions(id),
    channel         TEXT NOT NULL DEFAULT 'live',  -- live | beta | archive
    bundle_url      TEXT NOT NULL,
    bundle_sha256   BYTEA NOT NULL,
    size_bytes      BIGINT NOT NULL,
    engine_version  TEXT NOT NULL,
    lockfile        JSONB NOT NULL,          -- resolved dependency graph
    build_status    TEXT NOT NULL,           -- queued|building|ready|failed
    build_log_url   TEXT,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_builds_project_channel
    ON published_builds(project_id, channel, published_at DESC);
```
### 6.3 Azure Table Storage schemas
High-volume, non-relational data from published games. Chosen over PostgreSQL because write volume scales with players, not creators, and the access pattern is a pure key lookup.
| Table | PartitionKey | RowKey | Payload |
|---|---|---|---|
| `CloudSaves` | `{buildId}` | `{playerId}:{slot}` | `saveBlob` (gzipped JSON, max 512 KB), `savedAt`, `playtimeSec` |
| `Leaderboards` | `{buildId}:{boardId}` | `{invertedScore}:{playerId}` | `displayName`, `score`, `meta` |
| `PlayEvents` | `{buildId}:{yyyyMMddHH}` | `{ticks}:{guid}` | `eventType`, `sceneId`, `props` |
| `PlayerProgress` | `{buildId}` | `{playerId}` | `flags`, `achievements`, `lastSeen` |
⚠ **Row key design for leaderboards:** store `invertedScore` as a zero-padded fixed-width string of `(long.MaxValue - score)`. Table Storage sorts row keys lexicographically ascending only, so inversion gives descending score order without a scan.
⚠ **Cloud save size cap is enforced client-side and server-side.** A Module that writes unbounded data into the save object will destroy performance for every player of that game. Cap it at 512 KB compressed and reject writes above it with a clear error naming the offending Module namespace.
⚠ **Partition key choice is the scalability mechanism here, not an implementation detail.** Partitioning by `buildId` means load from one viral game's leaderboard cannot starve throughput for another game's saves, and Table Storage scales writes horizontally across partitions automatically. Never widen a partition key to something coarser (e.g. a global table with no per-game partition) to simplify a query — that reintroduces a single hot partition under load.
---
## 7. Project Document Format
### 7.1 Design principles
The project document is Forge's `wp-config.php` plus the database, in one portable file tree. It must be:
1. **Human-readable and diffable.** JSON, stable key ordering, one logical unit per file. This makes Git a viable backup and collaboration path for advanced users.
2. **Forward-compatible.** Unknown keys are preserved on read/write round-trip, never stripped. A project edited in an older client must not lose data added by a newer one.
3. **Fully self-describing.** A project plus its lockfile must be enough to build the game with no server calls.
4. **Migratable.** Every document carries a `schemaVersion`. Migrations are pure functions from version N to N+1, applied in sequence.
### 7.2 On-disk layout (export format)
```
my-game/
├── project.json               # manifest, settings, dependency ranges
├── forge.lock                 # resolved dependency graph with integrity hashes
├── scenes/
│   ├── village.scene.json
│   └── cave-01.scene.json
├── entities/
│   ├── goblin.entity.json
│   └── player.entity.json
├── data/
│   ├── items.table.json
│   ├── skills.table.json
│   └── loot.table.json
├── graphs/
│   ├── main-quest.graph.json
│   └── shopkeeper-dialogue.graph.json
├── assets/
│   ├── sprites/
│   ├── tilesets/
│   ├── audio/
│   └── assets.index.json      # id -> path, hash, metadata
├── overrides/                 # child-theme equivalent, layered over Art Packs
│   └── @forge-fantasy-pack/tilesets/grass.png
└── .forge/
    ├── cache/                 # gitignored
    └── history/               # local undo journal
```
### 7.3 project.json
```jsonc
{
  "schemaVersion": 3,
  "id": "5f8c2b10-9c4e-4a1a-9f2b-7d3e1c0a4b55",
  "title": "The Hollow Crown",
  "slug": "hollow-crown",
  "genreTemplate": "topdown-rpg",
  "engine": "^2.4.0",
  "dependencies": {
    "@forge/dialogue":        "^1.8.0",
    "@forge/inventory":       "^2.0.1",
    "@forge/turn-battle":     "^3.1.0",
    "@acme/weather-system":   "~0.9.4",
    "@pixelfoundry/fantasy-pack": "^4.2.0"
  },
  "activePack": "@pixelfoundry/fantasy-pack",
  "packOverrides": "./overrides",
  "settings": {
    "tileSize": 32,
    "targetFps": 60,
    "pixelPerfect": true,
    "defaultScene": "village",
    "viewport": { "width": 960, "height": 540, "scaleMode": "letterbox" },
    "inputMaps": { "default": "./data/input.default.json" },
    "locale": { "default": "en", "supported": ["en", "he", "es"], "rtl": ["he"] }
  },
  "moduleConfig": {
    "@forge/turn-battle": {
      "atbEnabled": false,
      "maxPartySize": 4,
      "damageFormula": "graph:combat-damage"
    },
    "@acme/weather-system": {
      "seasonLengthDays": 28,
      "startSeason": "spring"
    }
  },
  "publish": {
    "channel": "live",
    "analytics": true,
    "cloudSaves": true,
    "leaderboards": ["speedrun", "score"]
  }
}
```
### 7.4 Scene document
```jsonc
{
  "schemaVersion": 3,
  "id": "village",
  "name": "Oakhollow Village",
  "size": { "width": 60, "height": 40 },
  "tileSize": 32,
  "layers": [
    {
      "id": "ground",
      "kind": "tilemap",
      "tilesetRef": "pack:tilesets/outdoor-base",
      "zIndex": 0,
      "encoding": "rle-base64",
      "data": "eJzt3E1Lw0AQBuB..."
    },
    {
      "id": "decor",
      "kind": "tilemap",
      "tilesetRef": "pack:tilesets/outdoor-props",
      "zIndex": 10,
      "encoding": "rle-base64",
      "data": "eJztwTEBAAAAwqD..."
    },
    { "id": "entities", "kind": "entities", "zIndex": 20 },
    {
      "id": "collision",
      "kind": "collision",
      "encoding": "bitmask-base64",
      "data": "AAAA////AAAA..."
    }
  ],
  "entities": [
    {
      "instanceId": "e_7f3a",
      "definitionRef": "entities/shopkeeper",
      "components": {
        "Transform": { "x": 416, "y": 288, "z": 0 },
        "DialogueSource": { "graphId": "shopkeeper-dialogue" },
        "@acme/weather-system:WeatherReactive": { "seeksShelter": true }
      }
    }
  ],
  "triggers": [
    {
      "id": "t_cave_entrance",
      "shape": { "kind": "rect", "x": 800, "y": 120, "w": 64, "h": 32 },
      "on": "enter",
      "requires": { "playerControlled": true },
      "graphId": "goto-cave-01"
    }
  ],
  "ambient": {
    "musicRef": "pack:audio/village-theme",
    "lightColor": "#ffffff",
    "lightIntensity": 1.0
  }
}
```
### 7.5 Namespacing rule for Module-defined data
Component keys defined by a Module are namespaced with the package name:
```
"@acme/weather-system:WeatherReactive": { ... }
```
Core components are unprefixed (`Transform`, `Sprite`). This makes it impossible for two Modules to collide, makes orphaned data obvious when a Module is uninstalled, and lets the editor gray out rather than delete data belonging to a missing Module.
⚠ **Never delete unknown namespaced data.** If a user uninstalls a Module and reinstalls it later, their configuration must still be there. Orphaned component data is quarantined into `_orphaned` on save, not dropped.
### 7.6 forge.lock
```jsonc
{
  "lockfileVersion": 1,
  "engine": "2.4.3",
  "resolved": {
    "@forge/dialogue": {
      "version": "1.8.2",
      "resolved": "https://cdn.forge.dev/p/forge/dialogue/1.8.2/bundle.js",
      "integrity": "sha256-4kX2n8Qw...",
      "dependencies": {}
    },
    "@forge/turn-battle": {
      "version": "3.1.4",
      "resolved": "https://cdn.forge.dev/p/forge/turn-battle/3.1.4/bundle.js",
      "integrity": "sha256-9pLm3Zx...",
      "dependencies": { "@forge/inventory": "2.0.1" }
    }
  }
}
```
Same contract as `package-lock.json`. Builds are reproducible, integrity is verified at load time, and a compromised CDN cannot inject code.
---
## 8. Runtime Engine Specification
### 8.1 Package structure
The runtime ships as three separable layers so that a published game bundles only what it uses.
| Package | Contents | Approx. gzipped budget |
|---|---|---|
| `@forge/core` | ECS world, scheduler, event bus, save system, asset loader | 45 KB |
| `@forge/render-2d` | PixiJS v8 integration, tilemap renderer, camera, sprite batching | 130 KB (incl. Pixi) |
| `@forge/runtime-host` | Module sandbox, lifecycle, config resolution, dev tooling bridge | 60 KB |
Total engine floor: roughly 235 KB gzipped before any game content or Modules. ⚠ This is a hard budget. Every PR that raises it needs explicit sign-off. Bundle bloat is how browser game platforms die.
### 8.2 Frame loop
Fixed-timestep simulation with interpolated rendering. This is required for deterministic replays, consistent physics, and sane save/load.
```
                    ┌─────────────────────────────┐
                    │  requestAnimationFrame      │
                    └──────────────┬──────────────┘
                                   │
                    accumulator += clamp(dt, 0, 250ms)
                                   │
              ┌────────────────────▼────────────────────┐
              │  while (accumulator >= FIXED_STEP)      │
              │      runPhase(PreUpdate)                │
              │      runPhase(Update)        <- 16.6ms  │
              │      runPhase(PostUpdate)               │
              │      runPhase(Physics)                  │
              │      accumulator -= FIXED_STEP          │
              └────────────────────┬────────────────────┘
                                   │
                          alpha = accumulator / FIXED_STEP
                                   │
              ┌────────────────────▼────────────────────┐
              │      runPhase(PreRender)   (interpolate)│
              │      runPhase(Render)                   │
              │      runPhase(UI)                       │
              └─────────────────────────────────────────┘
```
⚠ The 250 ms clamp prevents the spiral of death when a browser tab is backgrounded and `dt` becomes enormous. Without it, the game freezes trying to catch up on thousands of missed steps.
### 8.3 System scheduling phases
Modules register systems into named phases. Ordering within a phase is resolved by declared dependencies, not by registration order. Registration-order dependence is a plugin ecosystem's worst failure mode because behavior changes based on install order.
| Phase | Purpose | Runs at |
|---|---|---|
| `PreUpdate` | Input sampling, timers, incoming network | Fixed step |
| `Update` | Game logic, AI, state machines | Fixed step |
| `PostUpdate` | Reactions to Update, derived state | Fixed step |
| `Physics` | Movement integration, collision resolution | Fixed step |
| `PreRender` | Transform interpolation, camera, culling | Per frame |
| `Render` | Draw calls | Per frame |
| `UI` | HUD, menus, overlays | Per frame |
```typescript
// Ordering is declarative, never implicit. Cycles are a hard build error.
world.addSystem({
  id: '@acme/weather-system:ApplyWindForce',
  phase: 'Physics',
  before: ['core:IntegrateVelocity'],
  after:  ['@acme/weather-system:ComputeWind'],
  query:  ['Transform', 'Velocity', '@acme/weather-system:WindAffected'],
  run: (ctx, entities) => { /* ... */ }
});
```
### 8.4 ECS storage
Archetype-based storage: entities with an identical component set share a contiguous chunk of typed arrays. Iteration over a query becomes a linear scan with no pointer chasing.
⚠ **Trade-off:** adding or removing a component moves the entity between archetypes, which is a copy. Modules that add and remove components every frame will thrash. The API surfaces this by making `addComponent` deferred to a command buffer flushed at the phase boundary, and by encouraging a boolean field on an existing component over a marker component for high-churn state.
**Target:** 5,000 active entities at 60 fps on a 2019 mid-range laptop and a 2021 mid-range Android phone. This is the benchmark gate in CI.
### 8.5 Save system
Saves are a snapshot of the ECS world plus module-owned global state.
```typescript
interface SaveFile {
  schemaVersion: number;
  engineVersion: string;
  projectId: string;
  buildId: string;
  createdAt: string;
  playtimeSec: number;
  /** Version of each installed module at save time. Drives migration. */
  moduleVersions: Record<string, string>;
  world: {
    entities: Array<{
      id: number;
      definitionRef?: string;
      components: Record<string, unknown>;  // namespaced keys
    }>;
    nextEntityId: number;
  };
  globals: Record<string, unknown>;   // namespaced: "@acme/weather:state"
  flags: Record<string, boolean | number | string>;
  currentScene: string;
  /** Preserved verbatim for modules not currently installed. */
  _orphaned: Record<string, unknown>;
}
```
⚠ **Save compatibility is the hardest ongoing problem in a plugin ecosystem.** A player is 40 hours into a game, the creator updates a Module, and the save breaks. Mitigations, all required:
1. Modules **must** declare a `migrateSave(from, to, data)` function if they bump a major version.
2. The runtime refuses to load a save whose module major version exceeds the installed one, with a clear message rather than silent corruption.
3. Published builds pin exact module versions in `forge.lock`. A player's session never sees a version change mid-run.
4. Creators updating a live game choose: new channel (old players stay on old build) or forced migration with a dry-run report showing which saves would fail.
---
## 9. The Module API
This is the platform's most important public surface. It should change slowly, break rarely and be versioned independently of the engine internals.
### 9.1 API design rules
1. **Everything a first-party Module can do, a third-party Module can do.** No private APIs. Enforced by building `@forge/dialogue`, `@forge/inventory` and `@forge/turn-battle` against the published API only, in CI, in a separate repo.
2. **Additive-only within a major version.** New optional fields and new hooks are allowed. Removing or narrowing anything is a major bump.
3. **Deprecation takes 12 months minimum**, with runtime console warnings and a codemod where mechanically possible.
4. **The API is a data contract, not an object graph.** Modules receive plain data and a narrow capability object. They never receive engine internals, DOM nodes or the `window` object.
### 9.2 Module manifest
```jsonc
{
  "schemaVersion": 2,
  "name": "@acme/weather-system",
  "version": "0.9.4",
  "displayName": "Dynamic Weather and Seasons",
  "summary": "Seasons, weather states and gameplay effects for outdoor scenes.",
  "author": { "name": "Acme Interactive", "userId": "9a1c..." },
  "license": "MIT",
  "engine": ">=2.3.0 <3.0.0",
  "kind": "module",
  "dependencies": { "@forge/dialogue": "^1.6.0" },
  "optionalDependencies": { "@forge/turn-battle": "^3.0.0" },
  "capabilities": ["render", "storage:local", "audio"],
  "provides": {
    "components": ["WeatherReactive", "WindAffected"],
    "systems": ["ComputeWind", "ApplyWindForce", "AdvanceSeason"],
    "graphNodes": ["GetSeason", "SetWeather", "OnWeatherChange"],
    "editorPanels": ["WeatherSettings"],
    "assets": ["overlays/rain.png", "overlays/snow.png", "audio/thunder.ogg"]
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "seasonLengthDays": { "type": "integer", "minimum": 1, "default": 28 },
      "startSeason": {
        "type": "string",
        "enum": ["spring", "summer", "autumn", "winter"],
        "default": "spring"
      }
    }
  },
  "saveSchemaVersion": 2,
  "entry": { "runtime": "./dist/runtime.js", "editor": "./dist/editor.js" }
}
```
Note the split entry points. **Editor code and runtime code are separate bundles.** A published game must never ship the Module's editor UI. This routinely halves bundle size across a project with a dozen Modules.
### 9.3 Runtime module contract
```typescript
// @forge/module-api - the complete public surface a runtime module sees.
export interface ForgeModule {
  /** Called once at world construction, before any scene loads. */
  setup(ctx: SetupContext): void | Promise<void>;
  /** Called when the world is torn down. Release all resources here. */
  teardown?(ctx: TeardownContext): void;
  /** Required if saveSchemaVersion has ever been bumped. */
  migrateSave?(from: number, to: number, data: unknown): unknown;
}
export interface SetupContext {
  readonly config: Readonly<Record<string, unknown>>;   // validated vs configSchema
  readonly engineVersion: string;
  readonly moduleName: string;
  defineComponent<T extends ComponentShape>(
    name: string,
    schema: JsonSchema,
    defaults: T
  ): ComponentHandle<T>;
  addSystem(def: SystemDefinition): void;
  defineGraphNode(def: GraphNodeDefinition): void;
  /** Typed pub/sub. The primary inter-module communication channel. */
  readonly events: EventBus;
  /** WordPress "filter" equivalent: transform a value in a chain. */
  addInterceptor<K extends keyof InterceptorMap>(
    point: K,
    priority: number,
    fn: (value: InterceptorMap[K], ctx: InterceptorContext) => InterceptorMap[K]
  ): void;
  /** Namespaced key-value store, persisted into the save file. */
  readonly storage: ModuleStorage;
  /** Only available if 'audio' capability was granted. */
  readonly audio?: AudioApi;
  /** Only available if 'render' capability was granted. */
  readonly render?: RenderApi;
  /** Only available if 'network' capability was granted and user consented. */
  readonly net?: NetApi;
  readonly log: Logger;
}
export interface SystemDefinition {
  id: string;
  phase: Phase;
  query: ReadonlyArray<string>;
  before?: ReadonlyArray<string>;
  after?: ReadonlyArray<string>;
  /** Skip this system when the query yields nothing. Default true. */
  skipIfEmpty?: boolean;
  run(ctx: TickContext, entities: EntityView): void;
}
export type Phase =
  | 'PreUpdate' | 'Update' | 'PostUpdate'
  | 'Physics' | 'PreRender' | 'Render' | 'UI';
export interface TickContext {
  readonly dt: number;            // fixed step in seconds
  readonly alpha: number;         // render interpolation factor, 0..1
  readonly elapsed: number;
  readonly frame: number;
  readonly world: WorldApi;
  readonly input: InputSnapshot;  // read-only
  readonly scene: SceneApi;
}
export interface WorldApi {
  create(components?: Record<string, unknown>): EntityId;
  destroy(id: EntityId): void;                     // deferred to phase boundary
  has(id: EntityId, component: string): boolean;
  get<T>(id: EntityId, component: string): Readonly<T> | undefined;
  set<T>(id: EntityId, component: string, value: Partial<T>): void;
  add<T>(id: EntityId, component: string, value: T): void;   // deferred
  remove(id: EntityId, component: string): void;             // deferred
  query(components: ReadonlyArray<string>): EntityView;
}
```
### 9.4 The interceptor system (WordPress filters)
Interceptors are the mechanism by which a Module modifies core or another Module's behavior without patching it. Well-chosen interception points are what make an ecosystem generative rather than merely additive.
```typescript
export interface InterceptorMap {
  'combat:damage':        { attacker: EntityId; target: EntityId; amount: number; type: string };
  'combat:hitChance':     { attacker: EntityId; target: EntityId; chance: number };
  'dialogue:line':        { speaker: string; text: string; locale: string };
  'dialogue:choices':     { choices: DialogueChoice[] };
  'inventory:canAddItem': { entity: EntityId; itemId: string; qty: number; allowed: boolean };
  'inventory:itemPrice':  { itemId: string; basePrice: number; vendor: EntityId };
  'movement:speed':       { entity: EntityId; speed: number };
  'render:tileTint':      { tileX: number; tileY: number; layer: string; tint: number };
  'save:beforeWrite':     { data: SaveFile };
  'save:afterRead':       { data: SaveFile };
  'scene:beforeLoad':     { sceneId: string; cancel: boolean };
}
```
Example: a weather Module slowing the player in snow without knowing anything about the movement Module.
```typescript
ctx.addInterceptor('movement:speed', 50, (value, { world }) => {
  const weather = ctx.storage.get<WeatherState>('state');
  if (weather?.current !== 'snow') return value;
  if (!world.has(value.entity, 'PlayerControlled')) return value;
  return { ...value, speed: value.speed * 0.7 };
});
```
⚠ **Interceptor discipline:**
- Interceptors must be pure with respect to the value. Mutating world state inside one causes order-dependent bugs that are nearly impossible for a creator to diagnose.
- Priority is an integer, default 50, lower runs first. Document the convention so authors do not all pick 0.
- The runtime tracks per-interceptor execution time and surfaces slow ones in the editor profiler, attributed by module name. Creators must be able to see which paid plugin is costing them 8 ms a frame.
### 9.5 Editor module contract
```typescript
export interface ForgeEditorModule {
  registerPanels?(reg: PanelRegistry): void;
  registerInspectors?(reg: InspectorRegistry): void;
  registerGraphNodes?(reg: GraphNodeUiRegistry): void;
  registerCommands?(reg: CommandRegistry): void;
  registerValidators?(reg: ValidatorRegistry): void;
}
```
⚠ Editor modules render inside the trusted editor SPA and therefore cannot execute arbitrary code the way runtime modules can. Editor UI is declared as a **serializable schema**, not as React components, and Forge renders it with first-party components:
```typescript
reg.addInspector('@acme/weather-system:WeatherReactive', {
  title: 'Weather Reactivity',
  fields: [
    { key: 'seeksShelter', type: 'boolean', label: 'Seeks shelter in rain' },
    { key: 'coldResistance', type: 'slider', min: 0, max: 1, step: 0.05 }
  ]
});
```
This costs authors some flexibility. It buys a consistent editor UX, guaranteed accessibility, working undo/redo, working localization, and no XSS surface in the editor. That trade is correct. Provide an escape hatch later via a sandboxed iframe panel with a narrow postMessage API, once the common cases are covered by declarative fields.
---
## 10. Security Model
This section is the highest-risk area of the platform. WordPress's plugin security record is its greatest weakness and Forge should not repeat it.
### 10.1 Threat model
| Threat | Vector | Severity |
|---|---|---|
| Malicious Module exfiltrates player data | Runtime module reads saves and posts them out | High |
| Malicious Module mines crypto in players' browsers | Unbounded compute in the frame loop | High |
| Supply chain attack on a popular Module | Compromised author account publishes a bad version | Critical |
| Module escapes sandbox into the editor origin | XSS via editor panel or asset metadata | Critical |
| Malicious asset triggers a decoder vulnerability | Crafted PNG/OGG uploaded as an Art Pack | Medium |
| Build worker compromise | Untrusted module source processed during bundling | Critical |
| Creator ships a game that phishes players | Custom HTML overlay imitating a login | Medium |
### 10.2 Runtime sandbox: three ranked options
**Option 1: QuickJS compiled to WASM, running in a Web Worker. Recommended.**
- Module code is interpreted by QuickJS inside WASM. It has no DOM, no `fetch`, no `window`, no prototype access to the host realm.
- The host passes in only the capability objects the manifest declared and the user approved.
- Compute is bounded by QuickJS interrupt handlers. A module exceeding its per-frame budget is suspended and reported, not allowed to hang the tab.
- Memory is bounded by the WASM linear memory cap.
- ⚠ Cost: roughly 3 to 10 times slower than native JS for hot loops, plus a serialization boundary for world access. Mitigate by keeping hot paths (rendering, physics integration, collision) in core native JS, and by exposing the ECS component arrays as a `SharedArrayBuffer` view so modules read and write component data directly without message passing.
- ⚠ `SharedArrayBuffer` requires cross-origin isolation (`COOP`/`COEP` headers) on every page hosting a game.
**Option 2: Native JS in a `srcdoc` iframe with a restrictive CSP.**
- Much faster. No interpreter overhead.
- Weaker isolation. Same-thread with other iframe content, and the security boundary is the browser's origin model rather than an interpreter. Sandbox escapes are browser bugs, not application bugs, but they do happen.
- Compute is unbounded. A malicious module can hang its frame.
- Reasonable for **first-party and verified-publisher modules only**, as a performance tier.
**Option 3: Visual scripting compiled to a restricted bytecode VM. No arbitrary JS.**
- Maximum safety. The instruction set is fully controlled.
- Severely limits what Authors can build, which starves the ecosystem.
- Correct choice for **creator-authored logic** (the graph editor), wrong choice for the Module API.
**Recommended combination:** Option 3 for creator scripting, Option 1 for third-party Modules, Option 2 as an opt-in fast path for Modules from verified publishers with a signed audit.
### 10.3 Capability model
Modules declare capabilities in their manifest. The editor shows them at install time, in plain language, and the runtime enforces them.
| Capability | Grants | Consent |
|---|---|---|
| `render` | Draw layers, shaders, overlays | Implicit at install |
| `audio` | Play and mix sound | Implicit at install |
| `storage:local` | Namespaced save data | Implicit at install |
| `storage:global` | Cross-project local storage | Explicit prompt |
| `network` | `fetch` to a declared allowlist of domains | Explicit prompt, domains shown |
| `input:raw` | Raw key and pointer events before mapping | Explicit prompt |
| `clipboard` | Read or write clipboard | Explicit prompt |
| `player-identity` | Player ID and display name | Explicit prompt |
⚠ **The `network` capability is the dangerous one.** Requirements: declared domain allowlist in the manifest, enforced by CSP `connect-src` on the game frame, shown to the creator at install and to the player on first run, and any change to the allowlist is a major version bump that requires re-consent.
### 10.4 Publishing pipeline security gates
```
Author publishes
      │
      ▼
[1] Manifest validation      → schema, semver, capability declaration coherence
      │
      ▼
[2] Static analysis          → eval/Function detection, obfuscation heuristics,
      │                        network calls outside allowlist, known-bad patterns
      ▼
[3] Dependency audit         → transitive deps resolve, no yanked versions,
      │                        no cycles, integrity hashes match
      ▼
[4] Sandboxed smoke run      → load in an isolated worker, run 600 ticks against
      │                        a fixture project, assert no crash, measure budget
      ▼
[5] Reputation gate          → new authors: manual review queue.
      │                        established authors: automated pass + spot audits
      ▼
[6] Immutable publish        → sign bundle, write hash, push to CDN, index
```
⚠ **Steps 2 and 4 run in Azure Functions with zero network egress except to Blob Storage, a hard 60 second timeout, a memory cap, and a fresh container per job.** Untrusted code is being processed. Treat every build worker as already compromised.
### 10.5 Author account security
Supply chain is the highest-severity risk in the table. A compromised popular Module reaches every player of every game using it.
- **2FA is mandatory** for any account that has published a package. No exceptions, no grace period after the first publish.
- **Publish tokens are scoped per package** and expire. CI tokens cannot publish new packages, only new versions of existing ones.
- **Trusted publishing via OIDC** from GitHub Actions, so no long-lived secret exists.
- **A publish notification** goes to every workspace with the package installed, and to the author, on every version.
- **A 24 hour delay** before a new version of a package with more than 1,000 installs becomes the default resolution target. Emergency same-day promotion requires a manual review. This window is what catches a compromise before it propagates.
### 10.6 Editor and content security
- Editor origin (`app.forge.dev`) serves no user content. Strict CSP, no `unsafe-inline`, no `unsafe-eval`.
- Game previews and published games run on a **separate origin** (`play.forge.dev` and per-game subdomains) so a compromised game cannot touch editor sessions or tokens.
- All user-supplied text (dialogue, item names, project descriptions) is rendered as text nodes, never as HTML. Rich text uses a restricted markup subset parsed into a safe AST.
- Uploaded images are re-encoded server-side rather than passed through, which neutralizes most crafted-file decoder attacks and strips EXIF.
- ⚠ Uploaded audio is transcoded to a normalized OGG/AAC pair, never served as-uploaded.
---
## 11. Art Pack (Theme) System
### 11.1 The core problem
WordPress themes work because HTML content is structurally independent of presentation. Game art is not so cleanly separable: a tileset has fixed dimensions, a sprite sheet has specific frame counts, animations have specific frame timings. Swapping art packs naively breaks the game.
The solution is a **contract** that packs must satisfy, analogous to the template hierarchy.
### 11.2 Pack contract
```jsonc
{
  "schemaVersion": 2,
  "name": "@pixelfoundry/fantasy-pack",
  "version": "4.2.0",
  "kind": "artpack",
  "engine": ">=2.0.0 <3.0.0",
  "grid": { "tileSize": 32, "spriteSize": { "width": 32, "height": 48 } },
  "implements": ["forge/topdown-rpg-basic@1", "forge/topdown-rpg-combat@1"],
  "tilesets": {
    "outdoor-base": {
      "src": "tilesets/outdoor-base.png",
      "columns": 16,
      "terrains": ["grass", "dirt", "water", "sand", "stone"],
      "autotile": "wang-2corner"
    }
  },
  "characters": {
    "template": {
      "animations": {
        "idle":   { "frames": 4, "fps": 6,  "directions": 4 },
        "walk":   { "frames": 8, "fps": 12, "directions": 4 },
        "attack": { "frames": 6, "fps": 15, "directions": 4 }
      },
      "anchor": { "x": 0.5, "y": 0.9 }
    },
    "sheets": {
      "villager-m": "characters/villager-m.png",
      "villager-f": "characters/villager-f.png"
    }
  },
  "ui": {
    "skin": "ui/skin.9slice.json",
    "font": { "family": "ui/pixel.woff2", "baseSize": 16, "lineHeight": 1.4 },
    "palette": {
      "bg": "#1a1420", "panel": "#2d2438", "text": "#f0e6d2",
      "accent": "#d4a017", "danger": "#c1445a"
    }
  },
  "audio": {
    "sfx": { "menu-select": "audio/select.ogg", "hit": "audio/hit.ogg" },
    "music": { "village-theme": "audio/village.ogg" }
  },
  "locales": ["en"],
  "attribution": { "required": true, "text": "Art by PixelFoundry (CC-BY-4.0)" }
}
```
### 11.3 The `implements` field
This is the key mechanism. A pack declares which **capability profiles** it satisfies. A project declares which profiles it needs. The editor only offers packs that satisfy the project's requirements, and warns precisely when a swap would break something.
| Profile | Requires |
|---|---|
| `forge/topdown-rpg-basic@1` | Ground and prop tilesets, 4-direction idle and walk, UI skin, core SFX |
| `forge/topdown-rpg-combat@1` | Attack and hurt and death animations, enemy sheets, combat SFX |
| `forge/topdown-rpg-interior@1` | Interior tileset, furniture props |
| `forge/ui-full@1` | Complete 9-slice UI kit, icon set of at least 64 icons |
### 11.4 Asset resolution order
Highest priority wins. This is the child-theme mechanism.
```
1. Project override           overrides/@pack-name/path/to/asset.png
2. Project-uploaded asset     assets/path/to/asset.png
3. Active Art Pack            @pixelfoundry/fantasy-pack -> path
4. Module-bundled asset       @acme/weather-system -> overlays/rain.png
5. Engine default placeholder (visibly ugly magenta, never silent failure)
```
⚠ **Never fail silently on a missing asset.** Render a magenta placeholder with the missing asset ID drawn on it, log a structured warning, and surface it in the editor's validation panel. A silently invisible sprite costs a creator hours of debugging.
### 11.5 Pack swapping UX
When a creator changes the active pack, the editor runs a **compatibility diff** before committing:
```
Switching @pixelfoundry/fantasy-pack@4.2.0 -> @moonlit/scifi-pack@2.0.1
  OK    118 tiles map by terrain tag
  OK    12 character sheets map by role tag
  WARN  Tile size differs (32 -> 16). Scenes will be rescaled.
  WARN  'attack' animation has 4 frames in target, 6 in source.
        Timing will be resampled.
  FAIL  3 props have no equivalent: 'well', 'market-stall', 'signpost'
        These will render as placeholders until remapped.
  [Preview changes]  [Remap manually]  [Cancel]
```
This is the single most demo-able feature of the entire platform and it is worth over-investing in.
---
## 12. Editor Specification
### 12.1 Stack
| Concern | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript 5.x | Large hiring pool, mature ecosystem, matches team expertise |
| Build | Vite 5 | Fast HMR, essential for a large SPA |
| State | Zustand + Immer | Redux ceremony is not worth it. Immer gives structural sharing for undo |
| Collaboration | Yjs + y-websocket over SignalR | CRDT, offline-capable, no server merge logic |
| Canvas | PixiJS v8 (shared with runtime) | One renderer, not two. Editor canvas is the runtime in edit mode |
| Node graph | React Flow + custom nodes | Do not build a graph library |
| Layout | Dockview | Resizable, dockable panel system |
| Forms | React Hook Form + Zod | Module `configSchema` compiles to Zod at load |
| i18n | i18next, RTL-aware from day one | ⚠ Hebrew and Arabic support must be structural, not retrofitted |
### 12.2 Panel layout
```
┌──────────────────────────────────────────────────────────────────────┐
│ Forge   File  Edit  View  Run    [▶ Play]  [Publish]     ○○○ (3 online)│
├────────────┬──────────────────────────────────────────┬──────────────┤
│ PROJECT    │                                          │ INSPECTOR    │
│            │                                          │              │
│ ▸ Scenes   │           SCENE CANVAS                   │ Shopkeeper   │
│   village  │        (PixiJS, pan/zoom/snap)           │ ┌──────────┐ │
│   cave-01  │                                          │ │Transform │ │
│ ▸ Entities │      [tile brush] [entity] [trigger]     │ │ x  416   │ │
│ ▸ Data     │                                          │ │ y  288   │ │
│ ▸ Graphs   │                                          │ ├──────────┤ │
│ ▸ Assets   │                                          │ │Dialogue  │ │
│ ▸ Modules  │                                          │ │ graph ▾  │ │
│            ├──────────────────────────────────────────┤ ├──────────┤ │
│ PACK       │ TILE PALETTE / GRAPH EDITOR / DATA TABLE │ │Weather ⚙ │ │
│ fantasy@4  │                                          │ └──────────┘ │
├────────────┴──────────────────────────────────────────┴──────────────┤
│ PROBLEMS (2)  │ CONSOLE  │ PROFILER  │ VERSION HISTORY               │
└──────────────────────────────────────────────────────────────────────┘
```
### 12.3 Editing surfaces
| Surface | Purpose | Notes |
|---|---|---|
| **Scene Canvas** | Tile painting, entity placement, trigger regions | Autotiling, multi-select, snapping, layer isolation |
| **Node Graph** | Quests, cutscenes, dialogue trees, event logic | Compiles to the restricted bytecode VM, not to JS |
| **Data Tables** | Items, skills, enemies, loot | Spreadsheet UI, CSV import/export, formula column support |
| **Inspector** | Component editing on the selected entity | Rendered from JSON Schema. Module fields appear automatically |
| **Module Manager** | Browse, install, configure, update | The "Plugins" page. Shows capabilities, size cost, frame cost |
| **Pack Manager** | Browse and swap Art Packs | Runs the compatibility diff from 11.5 |
| **Problems Panel** | Validation errors and warnings | Missing assets, broken refs, cyclic graphs, budget overruns |
| **Profiler** | Per-module frame cost attribution | ⚠ Essential. Creators must see which plugin is slow |
### 12.4 Undo and collaboration
Undo/redo is **not** a naive snapshot stack. It is a command log:
```typescript
interface EditorCommand {
  id: string;
  type: string;                  // 'scene.paintTiles', 'entity.setComponent'
  label: string;                 // shown in the undo menu
  apply(doc: ProjectDoc): void;
  invert(doc: ProjectDoc): EditorCommand;
  /** Commands touching disjoint paths can be reordered during merge. */
  affectedPaths: string[];
}
```
Collaboration uses Yjs CRDTs over the SignalR transport. The document is a `Y.Doc` with a sub-map per scene, entity and table, so two users editing different scenes never contend.
⚠ **Tilemap layers are the contention hotspot.** Two users painting the same layer produce per-tile conflicts. Model each tilemap layer as a `Y.Array` of tile IDs so resolution is per-tile last-write-wins rather than whole-layer. Do not store the layer as an opaque encoded string in the CRDT, even though it is stored that way at rest.
### 12.5 Play mode
Play mode boots the actual runtime in a cross-origin iframe against the in-memory document. Hot reload is granular:
| Change | Reload behavior |
|---|---|
| Tile paint | Patch the tilemap in place. No restart |
| Entity component value | Patch live instances. No restart |
| Data table row | Patch the table. No restart |
| Graph edit | Recompile the graph, swap it in. No restart |
| Module install or config change | Full world restart, state preserved where possible |
| Engine version change | Full page reload |
Instant iteration is the primary reason a creator chooses a browser tool over a desktop one. ⚠ Target: under 200 ms from edit to visible change for the no-restart cases.
---
## 13. Backend API
### 13.1 Conventions
- .NET 8 Minimal API, vertical slice organization, one folder per feature.
- All endpoints under `/api/v1`. Versioning by URL path, since the editor and the CLI are long-lived clients.
- Auth via OIDC bearer tokens. Workspace-scoped authorization policies.
- Problem Details (RFC 9457) for every error response.
- Idempotency keys required on all mutating marketplace endpoints.
- Cursor pagination everywhere. Never offset pagination on user-growable collections.
### 13.2 Endpoint surface
```
# Projects
GET    /api/v1/workspaces/{ws}/projects
POST   /api/v1/workspaces/{ws}/projects
GET    /api/v1/projects/{id}
PATCH  /api/v1/projects/{id}
DELETE /api/v1/projects/{id}
GET    /api/v1/projects/{id}/document?rev={rev}
POST   /api/v1/projects/{id}/revisions          # commit a new revision
GET    /api/v1/projects/{id}/revisions          # history, cursor paginated
POST   /api/v1/projects/{id}/revisions/{rev}/restore
GET    /api/v1/projects/{id}/export             # 302 to a signed zip URL
# Realtime
WS     /hubs/collab?projectId={id}              # SignalR: CRDT relay + presence
# Registry
GET    /api/v1/packages?q=&kind=&sort=&cursor=
GET    /api/v1/packages/{name}
GET    /api/v1/packages/{name}/versions
GET    /api/v1/packages/{name}/versions/{version}
POST   /api/v1/packages/{name}/versions         # publish (author, scoped token)
POST   /api/v1/packages/{name}/versions/{v}/yank
POST   /api/v1/registry/resolve                 # dependency resolution -> lockfile
# Marketplace
POST   /api/v1/checkout/sessions
POST   /api/v1/webhooks/stripe                  # signature verified
GET    /api/v1/workspaces/{ws}/licenses
GET    /api/v1/authors/me/earnings
# Assets
POST   /api/v1/workspaces/{ws}/assets/upload-url   # presigned, direct to Blob
POST   /api/v1/workspaces/{ws}/assets/commit       # finalize + trigger processing
GET    /api/v1/workspaces/{ws}/assets?cursor=
DELETE /api/v1/assets/{id}
# Publishing
POST   /api/v1/projects/{id}/builds
GET    /api/v1/builds/{buildId}
GET    /api/v1/builds/{buildId}/log
POST   /api/v1/builds/{buildId}/promote          # -> live channel
# Play services (called by published games, separate origin + rate limits)
POST   /api/v1/play/{buildId}/saves/{slot}
GET    /api/v1/play/{buildId}/saves/{slot}
POST   /api/v1/play/{buildId}/leaderboards/{board}/scores
GET    /api/v1/play/{buildId}/leaderboards/{board}?window=all|week
POST   /api/v1/play/{buildId}/events             # batched telemetry
```
### 13.3 Revision commit endpoint
The most important write path. It must handle concurrent commits without losing work.
```csharp
// Features/Projects/CommitRevision.cs
// Commits a new project revision using optimistic concurrency on head_revision.
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text.Json;
namespace Forge.Api.Features.Projects;
public sealed record CommitRevisionRequest(
    long   ExpectedHeadRevision,
    string? Label,
    bool   IsCheckpoint,
    JsonElement Document);
public sealed record CommitRevisionResponse(
    long RevisionId,
    string DocHash,
    DateTimeOffset CreatedAt);
public static class CommitRevisionEndpoint
{
    private const int MaxDocumentBytes = 32 * 1024 * 1024; // 32 MB
    public static IEndpointRouteBuilder MapCommitRevision(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/projects/{projectId:guid}/revisions", Handle)
           .RequireAuthorization("project:write")
           .WithName("CommitRevision")
           .Produces<CommitRevisionResponse>(StatusCodes.Status201Created)
           .ProducesProblem(StatusCodes.Status409Conflict)
           .ProducesProblem(StatusCodes.Status413PayloadTooLarge);
        return app;
    }
    private static async Task<IResult> Handle(
        Guid projectId,
        CommitRevisionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IDocumentValidator validator,
        ILogger<ForgeDbContext> log,
        CancellationToken ct)
    {
        var raw = JsonSerializer.SerializeToUtf8Bytes(req.Document);
        if (raw.Length > MaxDocumentBytes)
        {
            return TypedResults.Problem(
                title: "Project document too large",
                detail: $"Document is {raw.Length} bytes. Limit is {MaxDocumentBytes}.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }
        var validation = await validator.ValidateAsync(req.Document, ct);
        if (!validation.IsValid)
        {
            return TypedResults.ValidationProblem(validation.Errors);
        }
        var hash = SHA256.HashData(raw);
        // Serializable isolation. Concurrent commits to the same project must
        // not interleave and silently drop one author's work.
        await using var tx = await db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, ct);
        var project = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => new { p.Id, p.HeadRevision })
            .SingleOrDefaultAsync(ct);
        if (project is null) return TypedResults.NotFound();
        if (project.HeadRevision != req.ExpectedHeadRevision)
        {
            return TypedResults.Problem(
                title: "Revision conflict",
                detail: "The project changed since you loaded it. Rebase and retry.",
                statusCode: StatusCodes.Status409Conflict,
                extensions: new Dictionary<string, object?>
                {
                    ["actualHeadRevision"] = project.HeadRevision,
                    ["expectedHeadRevision"] = req.ExpectedHeadRevision
                });
        }
        // Content-addressed dedupe: an unchanged document is a no-op.
        var existing = await db.ProjectRevisions
            .Where(r => r.ProjectId == projectId && r.DocHash == hash)
            .OrderByDescending(r => r.Id)
            .FirstOrDefaultAsync(ct);
        if (existing is not null && existing.Id == project.HeadRevision)
        {
            await tx.CommitAsync(ct);
            return TypedResults.Ok(new CommitRevisionResponse(
                existing.Id, Convert.ToHexString(hash), existing.CreatedAt));
        }
        var revision = new ProjectRevision
        {
            ProjectId    = projectId,
            ParentId     = project.HeadRevision,
            AuthorId     = currentUser.UserId,
            Label        = req.Label,
            Doc          = req.Document,
            DocHash      = hash,
            SizeBytes    = raw.Length,
            IsCheckpoint = req.IsCheckpoint,
            CreatedAt    = DateTimeOffset.UtcNow
        };
        db.ProjectRevisions.Add(revision);
        await db.SaveChangesAsync(ct);
        await db.Projects
            .Where(p => p.Id == projectId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.HeadRevision, revision.Id)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), ct);
        await tx.CommitAsync(ct);
        log.LogInformation(
            "Committed revision {RevisionId} for project {ProjectId} ({Bytes} bytes)",
            revision.Id, projectId, raw.Length);
        return TypedResults.Created(
            $"/api/v1/projects/{projectId}/revisions/{revision.Id}",
            new CommitRevisionResponse(
                revision.Id, Convert.ToHexString(hash), revision.CreatedAt));
    }
}
```
⚠ Serializable isolation on a hot path will produce serialization failures under contention. The client must retry on 40001 with jitter. In practice contention is low because the CRDT layer already merges concurrent edits and only periodically snapshots to a revision.
### 13.4 Dependency resolution endpoint
```csharp
// Features/Registry/ResolveDependencies.cs
// Resolves a dependency range set into a concrete, integrity-checked lockfile.
namespace Forge.Api.Features.Registry;
public sealed record ResolveRequest(
    string EngineVersion,
    Dictionary<string, string> Dependencies,   // name -> semver range
    Dictionary<string, string>? Pinned);       // name -> exact version
public sealed record ResolvedPackage(
    string Version,
    string Resolved,
    string Integrity,
    Dictionary<string, string> Dependencies);
public sealed record ResolveResponse(
    int LockfileVersion,
    string Engine,
    Dictionary<string, ResolvedPackage> Resolved,
    List<ResolutionWarning> Warnings);
public sealed record ResolutionWarning(
    string Package, string Kind, string Message);
public interface IDependencyResolver
{
    Task<ResolveResponse> ResolveAsync(ResolveRequest req, CancellationToken ct);
}
public sealed class DependencyResolver : IDependencyResolver
{
    private readonly ForgeDbContext _db;
    private readonly IMemoryCache _cache;
    public DependencyResolver(ForgeDbContext db, IMemoryCache cache)
        => (_db, _cache) = (db, cache);
    public async Task<ResolveResponse> ResolveAsync(
        ResolveRequest req, CancellationToken ct)
    {
        var resolved = new Dictionary<string, ResolvedPackage>();
        var warnings = new List<ResolutionWarning>();
        var queue = new Queue<(string Name, string Range, string RequestedBy)>();
        foreach (var (name, range) in req.Dependencies)
            queue.Enqueue((name, range, "<root>"));
        var visited = new HashSet<string>();
        while (queue.Count > 0)
        {
            var (name, range, requestedBy) = queue.Dequeue();
            // Cycle guard. Duplicate requests are fine, cycles are not.
            var visitKey = $"{name}@{range}<-{requestedBy}";
            if (!visited.Add(visitKey)) continue;
            var candidates = await GetCandidateVersionsAsync(name, ct);
            if (candidates.Count == 0)
                throw new PackageNotFoundException(name);
            // Honour explicit pins over range resolution.
            PackageVersionDto? pick = null;
            if (req.Pinned?.TryGetValue(name, out var pinnedVersion) == true)
            {
                pick = candidates.FirstOrDefault(c => c.Version == pinnedVersion);
                if (pick is null)
                    warnings.Add(new(name, "pin-unavailable",
                        $"Pinned version {pinnedVersion} is not available."));
            }
            pick ??= SemVer.MaxSatisfying(
                candidates.Where(c => c.YankedAt is null).ToList(),
                range,
                c => c.Version);
            if (pick is null)
            {
                var yankedMatch = SemVer.MaxSatisfying(
                    candidates, range, c => c.Version);
                if (yankedMatch is not null)
                {
                    warnings.Add(new(name, "yanked",
                        $"Only yanked versions satisfy '{range}'. Using {yankedMatch.Version}."));
                    pick = yankedMatch;
                }
                else
                {
                    throw new NoSatisfyingVersionException(name, range);
                }
            }
            if (!SemVer.Satisfies(req.EngineVersion, pick.EngineRange))
            {
                warnings.Add(new(name, "engine-mismatch",
                    $"{name}@{pick.Version} targets engine {pick.EngineRange}, " +
                    $"project is on {req.EngineVersion}."));
            }
            // Diamond dependency: prefer the already-resolved version if it
            // satisfies this range too, otherwise flag it. Forge does NOT
            // support multiple versions of the same module in one world,
            // because ECS component names would collide.
            if (resolved.TryGetValue(name, out var already))
            {
                if (!SemVer.Satisfies(already.Version, range))
                {
                    warnings.Add(new(name, "version-conflict",
                        $"{requestedBy} needs '{range}' but {already.Version} " +
                        $"is already resolved. Resolution may be unstable."));
                }
                continue;
            }
            resolved[name] = new ResolvedPackage(
                pick.Version,
                pick.BundleUrl,
                $"sha256-{Convert.ToBase64String(pick.BundleSha256)}",
                pick.Dependencies);
            foreach (var (depName, depRange) in pick.Dependencies)
                queue.Enqueue((depName, depRange, $"{name}@{pick.Version}"));
        }
        return new ResolveResponse(1, req.EngineVersion, resolved, warnings);
    }
    private async Task<List<PackageVersionDto>> GetCandidateVersionsAsync(
        string name, CancellationToken ct)
    {
        return (await _cache.GetOrCreateAsync($"pkgver:{name}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            return await _db.PackageVersions
                .Where(v => v.Package.Name == name && v.ScanStatus == "passed")
                .Select(v => new PackageVersionDto(
                    v.Version, v.EngineRange, v.BundleUrl,
                    v.BundleSha256, v.YankedAt,
                    v.Dependencies.ToDictionary(d => d.DependsOnName, d => d.VersionRange)))
                .ToListAsync(ct);
        }))!;
    }
}
```
⚠ **Forge deliberately does not support multiple versions of one module in a single project.** npm can nest duplicate versions because module scope is lexical. ECS component names are global strings, so two versions of `@acme/weather-system` would both define `WeatherReactive` and collide. This constraint must be communicated to authors clearly, because it makes breaking changes far more expensive for the ecosystem than they are in npm.
---
## 14. Asset Pipeline
### 14.1 Upload flow
```
Editor                    API                    Blob            Function
  │                        │                       │                 │
  ├─ POST /upload-url ────►│                       │                 │
  │  (name, size, sha256,  ├─ quota check          │                 │
  │   mime)                ├─ dedupe by sha256     │                 │
  │◄── presigned PUT ──────┤                       │                 │
  │                        │                       │                 │
  ├─ PUT file ────────────────────────────────────►│                 │
  │                        │                       │                 │
  ├─ POST /assets/commit ─►│                       │                 │
  │                        ├─ verify size + hash ──►                 │
  │                        ├─ enqueue processing ──────────────────►│
  │◄── 202 { assetId } ────┤                       │                 │
  │                        │                       │◄── variants ────┤
  │◄══ SignalR: ready ═════┤                       │                 │
```
### 14.2 Processing per asset kind
| Kind | Processing | Outputs |
|---|---|---|
| Image (sprite/tile) | Validate dims vs pack grid, re-encode, generate WebP + PNG fallback | `original.png`, `opt.webp`, `thumb.webp` |
| Sprite sheet | Detect frame grid, extract frame metadata, trim transparent margins | sheet + `frames.json` |
| Tileset | Validate columns vs `tileSize`, generate terrain autotile masks | tileset + `terrain.json` |
| Audio (sfx) | Normalize to -16 LUFS, trim silence, encode OGG + AAC | `sfx.ogg`, `sfx.m4a` |
| Audio (music) | Normalize, detect loop points, encode streaming-friendly | `music.ogg`, `music.m4a`, `loop.json` |
| Font | Subset to project locale glyph coverage, WOFF2 | `font.woff2` |
⚠ **All decoding happens in the Function worker with hard resource caps and no network egress.** Image and audio decoders are a historically rich source of memory-corruption vulnerabilities and the input is untrusted.
⚠ **Font subsetting must account for Hebrew and Arabic.** Subsetting to Latin-only silently breaks RTL projects. Derive the glyph set from the project's declared locales plus all strings in its data tables.
### 14.3 Texture atlas packing (build time)
Sprites are packed into atlases at build time using MaxRects with bin-packing across the whole project. Rationale: draw call count is the dominant 2D rendering cost, and per-sprite textures force a state change per sprite.
- Atlas size cap 2048x2048. ⚠ 4096 is unsafe on older mobile GPUs.
- Sprites used in the same scene are packed into the same atlas where possible, computed from static scene analysis.
- Atlases are content-hashed so unchanged atlases stay in the browser cache across builds.
---
## 15. Build and Publish Pipeline
### 15.1 Stages
```
[1] Resolve      forge.lock from project.json ranges
[2] Validate     schema check, broken refs, missing assets, cyclic graphs
[3] Compile      script graphs -> bytecode; data tables -> packed binary
[4] Tree-shake   drop unreferenced assets, unused module editor bundles
[5] Atlas        pack textures, generate atlas manifests
[6] Bundle       runtime + modules + content -> chunked JS + data files
[7] Optimize     minify, brotli, generate service worker for offline play
[8] Emit         write bundle, compute hash, upload to Blob
[9] Distribute   invalidate CDN, register build record, update channel
```
### 15.2 Output layout
```
builds/{buildId}/
├── index.html
├── sw.js                          # offline-capable service worker
├── engine.{hash}.js               # core + render, shared across all builds
├── modules.{hash}.js              # resolved module bundles
├── content.{hash}.bin             # scenes, entities, tables (packed)
├── atlas-0.{hash}.webp
├── atlas-0.{hash}.json
├── audio/
└── manifest.json                  # PWA manifest + build metadata
```
⚠ `engine.{hash}.js` is content-hashed on the engine version, not the project, so it is shared across every game on the platform and hits a warm CDN cache. This meaningfully cuts first-load time for players who have played any other Forge game.
### 15.3 Export for self-hosting
Non-negotiable and shipped in v1. This is the trust anchor that made WordPress adoptable.
```bash
# Exports a fully self-contained playable build with no calls back to Forge.
forge export --project hollow-crown --out ./dist --standalone
```
`--standalone` disables cloud saves, leaderboards and telemetry, and falls back to `localStorage` saves. The resulting folder is static files that run from any web server or from `file://`.
⚠ Exported builds still contain third-party Module code under those modules' licenses. The export includes a generated `LICENSES.txt` and the build fails if any dependency has an unsatisfiable license (for example a marketplace module whose license forbids redistribution). Surface license terms at install time, not at export time.
---
## 16. Marketplace
### 16.1 Economics
| Parameter | Value | Rationale |
|---|---|---|
| Author revenue share | 80% | Above Unity Asset Store (70%). Author acquisition is the bottleneck |
| Payment processing | Stripe Connect, passed through | Transparent to authors |
| Payout schedule | Net 30, minimum $50 | Standard, avoids micro-payout fees |
| Refund window | 14 days, creator-initiated | Abuse-monitored per account |
| Free tier | Unlimited free packages | Free modules drive platform adoption |
### 16.2 Listing quality signals
Ranking is not by download count alone, which rewards incumbency and encourages gaming.
| Signal | Weight | Notes |
|---|---|---|
| Active installs (30d) | 25% | Retained usage, not raw downloads |
| Rating (Bayesian-adjusted) | 20% | Adjusted so 5 reviews cannot beat 500 |
| Maintenance recency | 15% | Last version vs current engine version |
| Performance budget | 15% | Measured frame cost from the smoke run. **Novel and valuable** |
| Bundle size cost | 10% | Smaller is ranked higher |
| Support responsiveness | 10% | Median first-response time on issues |
| Documentation completeness | 5% | Automated heuristic on the readme |
⚠ Publishing measured frame cost and bundle size per module is a differentiator no comparable marketplace offers, and it creates direct competitive pressure toward quality. Ship it from day one.
### 16.3 Trust tiers
| Tier | Requirements | Benefits |
|---|---|---|
| Unverified | Email verified | Free publishing, manual review per version |
| Verified | 2FA, identity verified, 3 months, under 1% refund rate | Automated publishing, verified badge |
| Partner | Verified plus a security audit and an SLA | Native JS fast path (Section 10.2 Option 2), featured placement |
---
## 17. Play Services
Optional backend services a published game can use. Each maps to a capability the creator opts into.
| Service | Storage | Notes |
|---|---|---|
| Cloud saves | Azure Table Storage | 512 KB cap, 5 slots, last-write-wins with a conflict prompt |
| Leaderboards | Azure Table Storage | Inverted row keys, windowed views, ⚠ see anti-cheat below |
| Achievements | Azure Table Storage | Server-validated where a rule can be expressed, client-asserted otherwise |
| Analytics | Table Storage into a daily Parquet rollup | Funnels, retention, scene drop-off heatmaps |
| Player identity | PostgreSQL | Anonymous by default, optional account linking |
⚠ **Leaderboards from a browser game cannot be trusted.** The client is fully controllable by the player. Mitigations that are honest about their limits:
- Rate limits and statistical outlier flagging.
- Optional replay submission: submit the input log, replay it server-side against the deterministic fixed-step simulation, and verify the outcome. This works precisely because Section 8.2 mandated a fixed timestep. It costs real compute, so make it opt-in per leaderboard.
- Label unverified boards as unverified in the default UI. Do not let creators imply integrity the system cannot deliver.
---
## 18. Performance Budgets
Enforced in CI. A PR that breaches a budget fails the build.
### 18.1 Runtime budgets
| Metric | Target | Hard fail |
|---|---|---|
| Engine bundle (gzipped) | 235 KB | 300 KB |
| Time to first frame (cold, 4G) | 2.5 s | 4.0 s |
| Time to first frame (warm cache) | 800 ms | 1.5 s |
| Frame time, 1000 entities, desktop | 6 ms | 10 ms |
| Frame time, 1000 entities, mid Android | 12 ms | 16 ms |
| Max entities at 60 fps, desktop | 5000 | 3000 |
| Peak heap, typical project | 180 MB | 300 MB |
| Per-module frame budget | 1.0 ms | 2.0 ms (warn to creator) |
### 18.2 Editor budgets
| Metric | Target | Hard fail |
|---|---|---|
| Editor cold load | 3.0 s | 5.0 s |
| Project open (100 scenes) | 1.5 s | 3.0 s |
| Edit to preview reflect | 200 ms | 500 ms |
| Tile paint stroke latency | 16 ms | 33 ms |
| Undo latency | 50 ms | 150 ms |
### 18.3 Reference devices
CI runs the runtime benchmark suite on a fixed device matrix, not on whatever the CI runner happens to be.
| Class | Device | Why |
|---|---|---|
| Low mobile | Moto G Power 2021 (Android 11) | Realistic floor for a large share of players |
| Mid mobile | Pixel 6a | Volume device |
| Low desktop | 2019 MacBook Air, integrated GPU | Common creator machine |
| Reference desktop | Ryzen 5 / GTX 1660 | Headroom check |
### 18.4 Scalability budgets
These are backend and infrastructure budgets, distinct from the client-side runtime/editor budgets above. Enforced by a load-test gate in CI (Milestone M5 exit criterion) and revisited every milestone that adds load-bearing surface (M5 backend, M6 publish, M7 collab/marketplace).
| Metric | Target | Hard fail |
|---|---|---|
| Concurrent collaborative editors, one project, one hub instance | 20 | 8 (below this is a regression, not a ceiling) |
| Concurrent editors platform-wide, zero lost writes | 200 | 100 |
| API p99 latency, read endpoints, under target load | 200 ms | 500 ms |
| API p99 latency, revision commit, under target load | 400 ms | 800 ms |
| DB connections per API instance (pooled) | ≤ 20 | 40 (must stay under `max_connections / instance_count` with headroom) |
| SignalR reconnect time after instance recycle, group/presence intact | 2 s | 5 s |
| Cloud save write throughput, single build partition | 500 req/s | 200 req/s |
| Time for an added API instance to reach steady-state readiness | 60 s | 120 s |
| Build worker queue drain rate under burst (100 queued jobs) | 5 min | 15 min |
⚠ These numbers are placeholders pending the Phase 0 / M5 load-testing harness — they exist so a number is always the target of discussion instead of a vibe. Revise them with data from the first real load test, not by argument.
---
## 19. Versioning and Migration
### 19.1 Independent version lines
| Artifact | Scheme | Breaking change cost |
|---|---|---|
| Engine | SemVer | Very high. Invalidates modules |
| Module API | SemVer, decoupled from engine | Very high. This is the ecosystem contract |
| Project schema | Integer, migration-only | Low. Migrations run automatically |
| Save format | Integer per module | High. Breaks players mid-game |
| Pack profile | `name@N` | Medium. Breaks pack compatibility |
### 19.2 Migration mechanics
```typescript
// Project schema migrations are pure, ordered and reversible where possible.
export const migrations: Migration[] = [
  {
    from: 1, to: 2,
    description: 'Split tilemap data from layer metadata',
    up: (doc) => { /* ... */ },
    down: (doc) => { /* ... */ }
  },
  {
    from: 2, to: 3,
    description: 'Namespace module-defined component keys',
    up: (doc) => { /* ... */ },
    down: null   // lossy, one-way
  }
];
```
Rules:
- Migrations run on read, never destructively on the stored revision. The original revision remains intact.
- A one-way migration prompts the user and creates an automatic checkpoint first.
- Migrations are covered by golden-file tests: a corpus of real projects at every historical schema version, migrated forward in CI.
### 19.3 Engine major version policy
Given that a major engine bump invalidates every module, the policy must be conservative:
- **At most one major engine version every 18 months.**
- Overlapping support for the previous major for 12 months after a release.
- A published codemod for every mechanical breaking change.
- ⚠ Projects on a published channel are **never** auto-upgraded across a major version. The creator opts in explicitly, previews the result, and can roll back.
---
## 20. Phased Roadmap
### Phase 0: Validation (6 to 8 weeks, before writing platform code)
Do this first. It is cheap and it can kill the project before you spend a year on it.
| Activity | Success signal |
|---|---|
| Interview 25 RPG Maker and Construct creators | 15+ name collaboration or web publishing as a real pain |
| Interview 10 RPG Maker plugin authors | 6+ express interest in a better distribution and payment channel |
| Build a clickable prototype of the pack-swap diff (Section 11.5) | Strong reaction in demos. This is the hook |
| Analyze RPG Maker plugin market size | Evidence that authors earn meaningful revenue today |
⚠ **Kill criteria:** if plugin authors are not interested, stop. A game builder without an ecosystem is a worse Construct 3, and Construct 3 already exists and is good.
### Phase 1: Vertical slice (4 to 6 months)
Goal: one complete, playable, publishable 15-minute RPG built entirely in Forge.
- ECS core, fixed-step loop, PixiJS rendering, tilemap and sprites
- Scene canvas with tile painting and entity placement
- Inspector driven by JSON Schema
- Three first-party modules: dialogue, inventory, turn-based battle, built against the public API only
- One complete Art Pack implementing `topdown-rpg-basic@1`
- Save/load, project persistence, revision history
- Publish to a URL
No marketplace, no collaboration, no third-party modules yet.
### Phase 2: Ecosystem foundations (4 to 5 months)
- Module sandbox (QuickJS in Worker), capability model, security gates
- Registry, dependency resolution, lockfiles
- `forge` CLI and module SDK with a local dev loop
- Documentation site with a complete API reference
- **Author beta: recruit 15 to 25 plugin authors directly and support them personally.** This phase succeeds or fails on hand-holding early authors
### Phase 3: Marketplace and collaboration (4 months)
- Stripe Connect, listings, licensing, payouts
- Yjs collaborative editing and presence
- Art Pack system with the compatibility diff
- Play services: cloud saves, leaderboards, analytics
- Export to standalone
### Phase 4: Scale (ongoing)
- Genre expansion to simulation and management templates
- Native wrappers (Capacitor) for mobile store distribution
- Team and studio plans, roles, review workflows
- Localization of the editor, starting with Hebrew, Spanish, Portuguese, Japanese
---
## 21. Risk Register
| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Ecosystem never forms. No authors, no plugins | High | Fatal | Phase 0 validation. Recruit authors before public launch. Fund the first 20 modules directly if needed |
| R2 | Sandbox performance makes modules unusably slow | Medium | High | `SharedArrayBuffer` component access, native fast path for verified publishers, benchmark gates in CI from week one |
| R3 | Sandbox escape leads to a security incident | Low | Critical | Origin separation, capability model, 24h publish delay, external audit before Phase 3 |
| R4 | Save compatibility breakage angers players | High | Medium | Pinned versions per build, mandatory migration functions, channel-based rollout |
| R5 | Godot or Construct ships an equivalent | Medium | High | Ecosystem and marketplace are the moat, not the editor. Move fast on authors |
| R6 | Art Pack swapping does not work in practice | Medium | High | Prototype in Phase 0. If the diff UX is not convincing, the theme analogy collapses |
| R7 | Marketplace attracts asset-flip and AI-slop listings | High | Medium | Quality signals over download counts, curation, refund-rate penalties |
| R8 | Storage cost of full-document revisions | Medium | Medium | Retention thinning, content-addressed dedupe, delta compression at rest |
| R9 | Cannot support multiple module versions, so breaking changes are toxic | High | Medium | Strong deprecation policy, codemods, heavy pressure on authors toward additive change |
| R10 | Legal exposure from user-generated game content | Medium | Medium | Clear ToS, DMCA process, moderation for public listings, no moderation obligation for private projects |
| R11 | Architecture works in single-instance dev but does not scale horizontally (stateful SignalR hub, in-memory rate limits, unpooled DB connections) | Medium | High | Section 5.5 scalability architecture and Section 1.5 guardrails enforced from M0/M5, load-test gate with budgets in Section 18.4, SignalR backplane decided before M7 collaboration ships, not after an incident |
---
## 22. Open Questions
These need decisions before Phase 1 code is written.
1. **Should the graph VM be Turing-complete?** Loops and recursion give creators power but also let them hang the game. Leaning toward bounded loops with an iteration cap, no recursion.
2. **Multiplayer at all in v1?** Even asynchronous features (shared worlds, visitor mechanics) add substantial backend scope. Leaning toward no, revisit in Phase 4.
3. **Own the identity system or federate?** Federating to Discord and Google reduces friction for creators but complicates payouts and account recovery. Probably both, with email as the canonical identity.
4. **Free-tier publishing limits?** Unlimited free hosting is a real cost center if a game goes viral. Options: bandwidth cap with a paid upgrade prompt, or ad-supported free tier (unpopular with creators).
5. **Desktop app in scope?** Electron or Tauri wrapper around the same SPA gives offline work and local file access. Cheap to add later, expensive to design for from the start. Defer, but keep the editor free of hard cloud dependencies so the option stays open.
6. **How opinionated should the RPG template be?** Too opinionated and it is RPG Maker with worse tooling. Too generic and creators face a blank page. Leaning toward a strong starter template that is fully deletable.
---
## Appendix A: Glossary
| Term | Meaning |
|---|---|
| **Project** | One game and all its content |
| **Module** | A plugin. Adds components, systems, graph nodes, editor panels |
| **Art Pack** | A theme. Tilesets, sprites, UI skin, audio, font |
| **Profile** | A capability contract an Art Pack declares it satisfies |
| **Component** | Typed, serializable data attached to an entity |
| **System** | A function running each tick over entities matching a query |
| **Interceptor** | A filter that transforms a value in a priority-ordered chain |
| **Graph** | Visual logic authored by the creator, compiled to bytecode |
| **Channel** | A published build stream (live, beta, archive) |
| **Capability** | A permission a Module declares and the user grants |
## Appendix B: Reference Comparison
| | Forge | RPG Maker MZ | Construct 3 | GDevelop | Godot |
|---|---|---|---|---|---|
| Browser-based | Yes | No | Yes | Partial | No |
| Real-time collaboration | Yes | No | No | No | No |
| Plugin marketplace | Yes, first-party | Third-party sites | Limited | Community | Asset Library (free) |
| Plugin sandboxing | Yes | No | No | No | No |
| Theme/asset swapping | Yes, contract-based | Manual | Manual | Manual | Manual |
| Self-host export | Yes | Yes | Yes | Yes | Yes |
| Pricing | Subscription | One-time | Subscription | Free / paid tiers | Free |
| Genre scope | RPG (expanding) | RPG | General 2D | General 2D | General |
**Forge's defensible differences: real-time collaboration, a sandboxed and measured plugin ecosystem with first-party monetization, and contract-based art pack swapping.** Everything else on this list is table stakes.

# 10. Server-side build/publish pipeline and the play origin

## Status
Proposed — needs explicit sign-off before implementation starts (CLAUDE.md
Section 6.1: this touches CSP and origin separation, both NON-NEGOTIABLE
guardrails).

## Context

`forge export` (docs/adr/0009, M6 Phase 5) already turns a real
`ProjectDocument` into a playable, self-contained build — but only as a
local CLI a creator runs on their own machine, writing to a local
directory. Nothing today lets a creator publish that build to a URL. That
is M6's other, still-open exit criterion (CLAUDE.md line 219: "a complete
15-minute RPG published to a URL **and** exported to `file://`") and the
gap tasks C1–C4 in this session's plan exist to close.

Three things stand between here and that exit criterion:
1. Something has to run the build **server-side**, off a creator's
   machine, triggered by an API call.
2. The result has to live somewhere with a real URL.
3. That URL has to be a genuinely separate origin from the editor
   (`app.forge.dev`) per CLAUDE.md Section 4.3 — "Never" #1 in Section 12
   is `unsafe-eval` for a library; this is the same category of guardrail
   the user's Section 12 list warns me not to quietly relax: *"a request to
   ship a view/feature without X because it's inconvenient right now."*
   Nobody asked for a shortcut here, but the honest thing is to name the
   shortcut I was tempted by and why I didn't take it (see Decision 5).

### What already exists that this can reuse

- `docs/SPEC.md` Section 15 describes a much larger pipeline: bytecode
  compilation, texture-atlas packing, tree-shaking, a shared
  content-hashed `engine.{hash}.js` across every game on the platform, a
  service worker for offline play, a multi-file `builds/{buildId}/`
  layout on a CDN. **None of that exists, and this ADR does not build
  it.** Same move as ADR 0009 relative to SPEC Section 7: the SPEC
  describes the eventual, CDN-optimized platform; this ADR scopes down to
  the smallest real thing that actually publishes a working game to a
  URL today, and says so plainly rather than quietly redefining "build
  pipeline" to mean something smaller. The gap is tracked in
  Consequences, not hidden.
- `packages/cli`'s `forge export --document <path> --out <dir>` (ADR
  0009) already does steps [1]–[9] of SPEC 15.1 in miniature: resolves
  module versions/config, hydrates guest bundles, runs `vite build`,
  inlines the bundle into one `<script type="module">` (needed for
  `file://`, and — Decision 4 below — for exactly the same reason,
  useful for a hashed-CSP play origin), and writes `LICENSES.txt`. This
  ADR's build step is "run that exact CLI as a subprocess," not a new
  bundler.
- `project_revisions.doc` (M5 Phase 3) already stores the full,
  immutable `ProjectDocument` for every committed revision, as `jsonb`.
  A build has a natural, already-existing input: a `revisionId`, not a
  freshly-uploaded file.
- `services/Forge.Functions.Scan` (M6 Phase 3/3-follow-up) is the exact
  shape of worker this needs: a plain, fully unit-testable
  claim/process/complete orchestrator class (`ScanOrchestrator`,
  `PendingVersionScanner`) with a thin `[TimerTrigger]` function on top
  that polling batches a bounded number of pending rows, plus a
  `SmokeRunGate` that spawns a Node subprocess, writes JSON to its
  stdin, and reads a verdict back from stdout with a hard timeout and a
  harness-failure/verdict distinction. The build worker is the same
  shape: claim a queued `Build` row, spawn a Node subprocess (the real
  `forge export` CLI), read back success/failure.
- `PlanGateRequirement`/`PlanGateHandler` (M5 Phase 5) were built ahead
  of their first caller specifically for "the export/publish wall"
  (`PlanGateRequirement.cs`'s own doc comment says so) and already
  support `WorkspaceResourceKind.Project` generically via
  `WorkspaceResolver` — the policy this needs
  (`new PlanGateRequirement(WorkspaceResourceKind.Project, "projectId")`)
  is new *policy registration*, not new *authorization plumbing*.
- `SecurityHeaders.cs`'s own doc comment already names the gap this ADR
  closes: *"The play origin's per-game CSP ... is a distinct policy
  applied where published games are actually served, starting in
  Milestone M6. It is not this one."*

### The one thing that makes the play-origin CSP hard, found by reading the actual output

`packages/player/scripts/inline-bundle.mjs` inlines the entire game as a
literal `<script type="module">…</script>` block in `index.html` — not a
`src=` reference. That is deliberate and load-bearing for `file://`
(`inlineBundle`'s own comment: relative `src=` module loads are
CORS-blocked under `file://`, confirmed with a real Playwright run). It
also means a played game's `index.html` is, by construction, **inline
script** — and CLAUDE.md's CSP rule is unconditional: never
`'unsafe-inline'` in `script-src`, no exceptions, and Section 4.9's CSP
linter fails a wildcard or `unsafe-inline`/`unsafe-eval` the same way it
would fail a hardcoded secret. Serving this exact artifact under any CSP
at all requires either loosening that rule (not on the table) or pinning
the one specific inline script by a CSP hash source
(`script-src 'sha256-<base64 of the exact script text>'`) — a real,
narrow CSP mechanism designed for precisely this case, and neither a
wildcard nor `unsafe-inline`/`unsafe-eval`. Decision 4 below is how that
hash gets computed and served.

## Decision

### 1. Scope: reuse the real export pipeline, not SPEC Section 15's aspirational one

A "build" is: take a project's latest committed revision, run it through
the exact `forge export --document` pipeline ADR 0009/M6 Phase 5g already
proved end to end, and publish the resulting single self-contained
`index.html` + `LICENSES.txt`. No atlas packing, no bytecode compilation,
no tree-shaking beyond what `vite build` already does, no shared
cross-game `engine.{hash}.js`, no service worker/offline play. Each
build is one immutable, content-addressed folder in Blob Storage,
directly analogous to SPEC 15.2's per-build files but without the
platform-shared `engine.{hash}.js` — every build currently embeds its
own copy of the engine, exactly like every local `forge export` already
does. **Flagged as future work**, not silently declared out of scope:
a shared-engine CDN cache is a genuine, measurable win once there are
enough published games for it to matter, and is real follow-on
engineering, not a correctness gap.

### 2. Domain: a `Build` entity, trimmed from SPEC 6.2's `published_builds`

```csharp
public sealed class Build
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public long RevisionId { get; set; }        // FK -> project_revisions(id); the actual build input
    public BuildStatus Status { get; set; }      // Queued | Building | Ready | Failed
    public string? BundleBlobPath { get; set; }  // set on Ready
    public byte[]? BundleSha256 { get; set; }
    public long? SizeBytes { get; set; }
    public string? InlineScriptSha256Base64 { get; set; } // Decision 4 — the CSP hash source for this build
    public string? ErrorMessage { get; set; }     // set on Failed; never a raw stack trace (CLAUDE.md 1.1 #5 — no internals in a response a client reads, this is closer to that spirit even though it's operator-facing)
    public Guid? RequestedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
```

Deliberately **no** `channel` (`live`/`beta`/`archive`) and no
`lockfile` column yet: there is no dependency-*range* resolution to lock
(`ProjectDocument.installedModules` already pins exact, resolved
versions — see ADR 0009 Decision 3 — so there is nothing a lockfile would
add over what `Build.RevisionId` → the revision's own `doc` already
pins). Every build publishes straight to `live`. Multi-channel publishing
is real, named future work (SPEC 6.2 already has the column name
reserved), not implemented here because nothing in the plan up to M6
needs it yet.

Migration: `builds` table, FK to `projects(id)` and `project_revisions(id)`,
index on `(project_id, created_at DESC)` for "list this project's
builds," and a partial index on `(status)` for the worker's claim query
(`WHERE status = 'queued'`) — the same shape
`PendingVersionScanner`'s claim query already needs, verified with
`EXPLAIN ANALYZE` per CLAUDE.md guardrail 19, not assumed.

### 3. Trigger and status: two endpoints on the existing `Forge.Api`

```
POST /api/v1/projects/{projectId}/builds   -> 202 { buildId }
GET  /api/v1/projects/{projectId}/builds/{buildId} -> { status, playUrl?, errorMessage? }
GET  /api/v1/projects/{projectId}/builds   -> list, newest first (TanStack Virtual on the editor side once there's a UI for it — not in this ADR's scope, C2/C3/C4 are backend-only)
```

`POST` requires **both** `project:write` (an Editor/Admin workspace role
— the existing `WorkspaceRoleRequirement`) **and** a new `project:pro`
policy (`PlanGateRequirement(WorkspaceResourceKind.Project, "projectId")`,
registered in `ForgeAuthorizationExtensions` next to `workspace:pro`) —
SPEC 23.2/23.5's "Free doesn't publish at all" wall, enforced the same
server-side way billing already enforces it: a `402` with a clear
upgrade path (SPEC 1723), never a silent no-op (CLAUDE.md guardrail 16).

`POST` resolves the project's **latest committed revision**
(`project_revisions` ordered by `id desc`, already how `CommitRevision`
work reads "current" elsewhere) — not the live in-editor document, which
may be mid-edit and was never confirmed as a checkpoint. If a project has
no committed revision yet, `400` with "commit at least one revision
before publishing" (Section 5.5 copy rules: what happened, why, what to
do next). Writes a `Build` row with `Status = Queued`,
`RevisionId = <that revision>`. No file upload happens here — the
revision's `doc` is already in Postgres; the worker reads it directly.

### 4. Worker: `Forge.Functions.Build`, the same shape as `Forge.Functions.Scan`

A `BuildOrchestrator.BuildNextAsync`, unit-testable with no Functions
Worker dependency (mirroring `ScanOrchestrator`):

1. `BuildScanner.ClaimNextAsync` — optimistic
   `UPDATE builds SET status='building' WHERE id = (SELECT id FROM builds WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
   same concurrency-safe claim pattern `PendingVersionScanner` already
   uses for exactly the same "N worker instances, no double-processing"
   reason (CLAUDE.md guardrail 20 applies to workers too, not just API
   replicas).
2. Read `project_revisions.doc` for the claimed `RevisionId`, write it to
   a temp `ProjectDocumentExportFile`-shaped JSON (`{projectId, document}`
   — the exact shape ADR 0009's editor "Export Project" button already
   produces and `forge export --document` already accepts).
3. Spawn `node packages/cli/dist/index.js export --document <tmp> --out <tmpOutDir>`
   as a subprocess — the real CLI, unmodified, the same
   `Process`/`ProcessStartInfo` pattern `SmokeRunGate` already
   established (`RedirectStandardOutput`/`Error`, a hard timeout via a
   linked `CancellationTokenSource`, `Kill(entireProcessTree: true)` on
   timeout). Unlike `SmokeRunGate`'s small JSON-over-stdout verdict, the
   *output* here is a multi-megabyte file (the built `index.html`, which
   embeds the QuickJS WASM binary as base64 — M6 Phase 5g's actual
   fixture build was several hundred KB to low-MB range) — read it off
   `<tmpOutDir>/index.html` from disk afterward, not off stdout, to avoid
   forcing a large payload through a pipe built for a small one.
4. On subprocess success: hash `<tmpOutDir>/index.html`'s bytes
   (`BundleSha256`), extract and hash the inline `<script type="module">…</script>`
   block's exact text content for the CSP hash source
   (`InlineScriptSha256Base64` — parsed the same deliberate way
   `inline-bundle.mjs` itself locates that tag, not a generic HTML
   parse), upload `index.html` and `LICENSES.txt` to Blob Storage at
   `builds/{buildId}/`, mark `Status = Ready`.
5. On subprocess failure (non-zero exit, including the CLI's own
   license-check failure — ADR 0009's `writeLicensesFile` already throws
   a clear message for a disallowed license, which becomes
   `ErrorMessage` verbatim) or timeout: mark `Status = Failed` with
   `ErrorMessage`. Same harness-failure-vs-real-verdict distinction
   `SmokeGateHarnessException` already draws: a process that never
   started or was killed for hanging is an infra problem (log with full
   context per guardrail 11, leave `Queued` for a retry rather than
   asserting `Failed`, so a transient host issue doesn't permanently
   brand a fine project as broken); a process that ran and exited
   non-zero with a real error message is a genuine `Failed` verdict.

**Named, not hidden, gap:** `SmokeGateOptions.NodeExecutablePath`/
`CliBundlePath` are already configuration-only in this repo — nothing
here packages Node itself, `packages/player`'s full `node_modules`
(vite, the QuickJS WASM package, etc.), or the built `packages/cli/dist`
into an Azure Functions deployment artifact. Consumption-plan Functions
are not a great fit for a `vite build` subprocess needing a real,
multi-hundred-MB `node_modules` tree on disk; this most likely wants
Premium plan with a mounted file share, or a custom container, decided
at actual deploy time. This is the same category of already-accepted gap
as `Forge.Functions.Scan`'s own Node dependency (that project's `.csproj`
comment already says the trigger wiring itself "could not be verified
any way other than a real CI build") — not a new problem this ADR
introduces, and not blocking: `BuildOrchestrator`/`BuildScanner` are
fully testable against a real Postgres Testcontainer with the real built
CLI on the CI runner's own filesystem (which already has Node — it's a
JS/TS monorepo), the same way `ScanOrchestratorTests` already proves
gate 4 without solving Azure deployment packaging.

### 5. The play origin: a separate `Forge.Play` host, not a Host-header branch in `Forge.Api`

Considered and rejected: branching inside `Forge.Api`'s existing
`Program.cs` on the `Host` header to apply a different CSP for play
traffic. It would work in the narrow sense that a browser still sees two
origins (different hostnames get different CSP, different cookie scope),
and it would have been less code today. Rejected anyway, for a concrete
reason grounded in what this codebase already does, not a vague
principle: `Forge.Api` carries the OpenIddict Bearer auth pipeline, the
refresh-token cookie middleware, `ICurrentUser`, workspace authorization
— none of which a played game (fully public, unauthenticated, and
untrusted by definition, since it renders a creator's project and
potentially third-party module code) has any business running near. One
process serving both means a bug in routing, a missing `[Authorize]`, or
a future change to `Program.cs`'s middleware order is now capable of
leaking editor-origin behavior into play traffic or vice versa — exactly
the kind of single point of failure Section 4.3's "no exceptions"
reads as ruling out, not just the CSP header string in isolation.
**A physically separate host is the version of origin separation that
survives a mistake somewhere else in `Forge.Api`, not just the version
that looks separate from a browser tab today.**

`services/Forge.Play/` — a new, minimal ASP.NET Core Minimal API host,
structurally parallel to `Forge.Api` but deliberately smaller:

- **No** `Forge.Infrastructure.AddForgeAuth`/`AddForgeAuthorization`, no
  Identity, no OpenIddict, no cookies of any kind. It has nothing to
  authenticate — published games are public.
- **No** direct Postgres dependency. It never needs to know about
  `Build` rows, workspaces, or plans — only "does this `buildId` have
  content in Blob Storage." This also keeps it maximally simple to scale
  (guardrail 18: not just "no blocking in-process state" but *no state
  of its own at all* — Blob Storage is the only backing store).
- Two real routes:
  - `GET /{buildId}/` (and `/{buildId}/index.html`) → streams the blob,
    `Content-Type: text/html`, `Cache-Control: public, max-age=31536000, immutable`
    (content-addressed by `buildId`, safe to cache forever), and this
    origin's own CSP header (below) — computed from a small
    `builds/{buildId}/meta.json` sidecar
    (`{ "inlineScriptSha256Base64": "..." }`) the `Forge.Functions.Build`
    worker uploads alongside `index.html`, so `Forge.Play` never needs a
    database round trip to serve a request, only two blob reads.
  - `GET /health`.
  - A `buildId` with no blob → `404` (a real "not found," not the
    cross-tenant-masking `404` `Forge.Api` uses for authorization — there
    is no tenant boundary being hidden here, it is genuinely either
    published or not).
- Rate-limited the same way any other public, unauthenticated,
  potentially-expensive GET in this codebase already is — the existing
  Redis-backed `RateLimitingMiddleware`'s IP-keyed policy, reused rather
  than reinvented. A real CDN in front of this in production would
  absorb the overwhelming majority of repeat traffic given the
  `immutable` cache header, which is the natural next step (SPEC's own
  "multi-region CDN for published games" line, 203) but is
  infrastructure configuration outside this repo, not blocking a correct
  origin-separated implementation today.

**Local/CI story:** `docker-compose.yml`/`playwright.fullstack.config.ts`
already orchestrate `Forge.Api` on its own port; `Forge.Play` runs the
same way, on its own port, with its own `Play:BaseUrl` config value
(mirroring `Editor:BaseUrl`'s existing `IConfiguration["..."]` pattern in
`CheckoutSessionEndpoint.cs`) — good enough to prove real origin
separation locally (two distinct `http://localhost:PORT` origins, which
the browser still treats as cross-origin) without needing a second real
DNS name until deployment.

### 6. The play-origin CSP itself

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval' 'sha256-<per-build hash>';
style-src 'unsafe-inline';   -- Vite inlines the build's own CSS into a <style> tag the same way it inlines JS; a per-build style hash is the more correct fix, tracked as a follow-up rather than blocking this ADR on a second parser
connect-src 'self' https://api.forge.dev;
img-src 'self' data: blob:;
font-src 'self' data:;
worker-src 'self' blob:;
form-action 'none';
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
upgrade-insecure-requests
```

No `report-uri` yet — `Forge.Api`'s `/api/v1/csp-report` is an
authenticated-origin concern; a played game reporting CSP violations
needs its own unauthenticated ingestion endpoint (real, small, future
work, not blocking this ADR).

`'sha256-<per-build hash>'` is **not** a static value: `Forge.Play`
reads it per request from that build's own `meta.json` sidecar and
builds the header per response. `tools/security/csp-lint.mjs` (Section
4.9's CI gate) checks for `unsafe-eval`/`unsafe-inline`/wildcards in
`script-src` — a `'sha256-...'` source is none of those, so this stays
green under the existing linter without weakening it. **`style-src
'unsafe-inline'` is a real, named exception to the "never" rule** and I
am flagging it rather than shipping it quietly: it exists because Vite's
own build output inlines the page's CSS into a `<style>` tag the same
way `inline-bundle.mjs` inlines JS, and computing a per-build style hash
the same way as script needs its own small parser change to
`inline-bundle.mjs`/the worker, which I did not want to bundle into an
already-large ADR. **I should not ship this as `unsafe-inline` without
your explicit sign-off given CLAUDE.md's "never" wording covers CSP
directives generally, not only `script-src`** — flagging this specific
point for the confirmation this ADR is already blocked on, not treating
"CSS is lower-risk than JS" as license to decide it myself.

## Consequences

- **What this closes:** M6's "published to a URL" exit criterion becomes
  reachable — `POST .../builds` → poll `GET .../builds/{id}` → `Ready` →
  `https://play.forge.dev/{id}/` is a real, playable, correctly
  origin-separated, correctly-CSP'd game, built from a real
  editor-authored project via the exact pipeline ADR 0009 already proved.
- **What stays out of scope, honestly:** SPEC Section 15's shared
  cross-game `engine.{hash}.js`, atlas packing, bytecode compilation,
  service-worker offline play, build channels
  (`live`/`beta`/`archive`), a real CDN/Front Door in front of
  `Forge.Play`, Consumption-plan Node packaging for
  `Forge.Functions.Build`, and per-build CSS hashing (shipped instead as
  a named, called-out `style-src 'unsafe-inline'` pending your sign-off).
  Each is real, identifiable follow-on work, not a silently narrowed
  definition of "done."
- **New public, unauthenticated attack surface:** `Forge.Play` is the
  first host in this repo that serves arbitrary creator/third-party
  content to the open internet with no auth at all. Its total lack of
  Postgres/Identity/cookie dependencies is deliberate hardening (a
  successful attack against it has nothing sensitive to reach), but it
  should get the same CI security gates as everything else — header
  assertions against its specific CSP, added to
  `services/Forge.Tests/Security/HeaderTests.cs`'s pattern — before C4 is
  called done.
- **New index needed:** `builds(status)` partial index for the worker's
  claim query, `builds(project_id, created_at desc)` for the status/list
  endpoints — both shipped in the same migration per guardrail 19, not
  assumed.
- **Task split going forward (unchanged from the session plan):** C2
  (`Build` entity + migration + the two `Forge.Api` endpoints + the new
  `project:pro` policy), C3 (`Forge.Functions.Build`:
  `BuildScanner`/`BuildOrchestrator`, unit-tested against a real Postgres
  Testcontainer and the real built CLI, mirroring
  `ScanOrchestratorTests`), C4 (`Forge.Play` host + its CSP + the E2E
  proof: publish a real editor-built project, fetch it from a second,
  genuinely distinct local origin, play it, assert zero CSP violations
  and zero cross-origin leakage — the "published to a URL" half of M6's
  exit criterion, proved the same rigor as M6 Phase 5g proved the
  `file://` half).

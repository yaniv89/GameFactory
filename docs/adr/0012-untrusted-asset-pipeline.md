# 12. Untrusted asset pipeline: processing architecture and library choices

## Status
Accepted.

## Context

THREAT-MODEL.md already names this gap: **T6, "Crafted asset exploits an
image or audio decoder," CWE-787, High, primary control "Isolated worker,
re-encode never pass-through, resource caps."** Nothing has actually built
that control yet — `services/Forge.Functions.Assets/Placeholder.cs` still
throws `NotImplementedException`, and there is no `Asset` entity, no
upload endpoint, no decoder anywhere in the repo. E2–E4 in this session's
plan exist to close that; this ADR (E1) decides the architecture and the
specific library choices *before* any of that code gets written, per
CLAUDE.md Section 6.1's session protocol — this is exactly the kind of
decision that should be argued once in writing rather than accreted
endpoint-by-endpoint.

Two things make this genuinely different from every other pipeline this
codebase already runs untrusted input through (module bundles via
`Forge.Functions.Scan`, project exports via `Forge.Functions.Build`):

1. **The untrusted content here is binary, not source text.** Gate 4's
   `SmokeRunGate` (docs/adr/0010's own reference point) isolates untrusted
   *JavaScript* by running it inside QuickJS-in-WASM — a language-level
   sandbox. There is no equivalent "run this image in an interpreter"
   option. Isolation here has to come from *what decodes the bytes*, not
   from a VM around the decode.
2. **CLAUDE.md Section 2 pins the whole tech stack and lists no image or
   audio processing library at all.** This ADR is the place that gap gets
   closed, deliberately and in writing, not the place a dependency gets
   added quietly inside an endpoint handler.

### What already exists that this reuses

- `docs/SPEC.md` Section 14 describes the full aspirational pipeline:
  presigned direct-to-Blob upload, five processing kinds (image, sprite
  sheet, tileset, two audio kinds, font), LUFS normalization, autotile
  mask generation, font subsetting for RTL locales, build-time atlas
  packing. **None of it exists, and this ADR does not build all of it** —
  same move as ADR 0009 relative to SPEC Section 7 and ADR 0010 relative
  to SPEC Section 15: scope down to the smallest real thing that actually
  closes T6 for the asset kind the platform needs *right now*, and say so
  plainly rather than quietly redefining "asset pipeline" to mean
  something smaller.
- `assets` (SPEC 6.2, line ~413) already has a real schema: workspace
  scoping, optional project scoping (`NULL` = shared), `kind`,
  `blob_path`, `sha256` with a `(workspace_id, sha256)` dedupe index,
  `derived_from` for transcoded variants. It has no `status` column —
  this ADR adds one (Decision 2).
- `workspaces.storage_quota_mb` (`Workspace.StorageQuotaMb`, already
  mapped, default 500) is the quota SPEC 14.1's "quota check" step reads
  from — it exists and is unused today.
- `PendingVersionScanner`/`ScanOrchestrator` and
  `BuildScanner`/`BuildOrchestrator` (docs/adr/0010 Decision 4) are both
  the exact same shape this needs: an optimistic
  `UPDATE ... WHERE status = 'pending' ... FOR UPDATE SKIP LOCKED
  RETURNING *` claim query, a plain orchestrator class fully testable
  against a real Postgres Testcontainer with no Functions Worker
  dependency, and a claim/process/complete lifecycle. The asset worker is
  the same shape a third time — not a new pattern.
- `PublishVersionEndpoint` (docs/adr/0010's other reference point)
  already establishes this repo's actual upload convention: bundle bytes
  arrive base64-encoded in a JSON request body to `Forge.Api`, get
  size-capped and hashed, and are written to Blob from the API process —
  **not** SPEC 14.1's presigned-direct-to-Blob two-step flow, which
  nothing in this repo has ever implemented. Decision 3 follows that
  precedent rather than introducing a second upload mechanism.
- `RateLimitingMiddleware`, `WorkspaceRoleRequirement`/
  `WorkspaceResourceKind.Workspace`, and the cross-tenant-404 authorization
  pattern are all already wired and reusable verbatim.

## Decision

### 1. Scope: image assets only, v1

The Art Pack system (SPEC Section 11) is what E4 actually needs this
pipeline *for*: SPEC 11.4's asset resolution order lists
`Project-uploaded asset assets/path/to/asset.png` as priority 2, directly
under project overrides — sprites and tilesets, always images. Audio and
fonts in a pack (SPEC 11.2's `audio`/`ui.font` keys) are pack-bundled, not
project-uploaded, so nothing downstream needs a creator to upload audio or
font files yet.

**v1 accepts exactly `image/png`, `image/jpeg`, `image/webp`.**
Everything else — `audio/*`, `font/*`, and explicitly **`image/svg+xml`**
(an SVG is not raster data; it is inline-executable markup that can carry
`<script>`, `on*` handlers, and external references — accepting it as an
"image" would reopen exactly the CWE-79 hole `@forge/richtext` (docs/adr/0011)
exists to close, through a completely different door) — is rejected at
upload with `422` and a copy-rules-compliant message naming the rejected
type and what *is* accepted, never silently dropped or queued to fail
later.

**Explicitly deferred, named rather than hidden:** audio normalization/
loop-point detection/OGG+AAC encoding, font subsetting, sprite-sheet frame
detection, tileset autotile mask generation, and SPEC 14.3's build-time
atlas packing. Each is real follow-on engineering with its own decoder
risk profile (audio codecs are at least as historically vulnerable as
image codecs) and deserves its own ADR when a real caller needs it, not a
rubber-stamped extension of this one.

### 2. `Asset` entity, trimmed from SPEC 6.2's `assets` table, with a real status machine

```csharp
public enum AssetStatus { Pending, Ready, Failed }

public sealed class Asset
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid? ProjectId { get; set; }         // null = shared across the workspace's projects
    public string OriginalName { get; set; } = "";
    public string DeclaredMimeType { get; set; } = ""; // client-supplied, verification-only — never trusted for processing (Decision 4)
    public AssetStatus Status { get; set; }
    public string QuarantineBlobPath { get; set; } = ""; // original bytes, private container, Function-only access
    public string? ProcessedBlobPath { get; set; }        // set on Ready — the re-encoded PNG this asset actually resolves to
    public byte[] Sha256 { get; set; } = [];               // hash of the ORIGINAL bytes, computed at upload (Decision 3) — dedupe key
    public long SizeBytes { get; set; }                    // original size, what counts against quota (Decision 5)
    public int? Width { get; set; }                        // set on Ready, from the real decoded image
    public int? Height { get; set; }
    public string? ErrorMessage { get; set; }               // set on Failed; a creator-facing reason, never a raw exception (CLAUDE.md 1.1 #5 / 5.5)
    public Guid RequestedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
```

`kind` is dropped from SPEC 6.2's version: v1 has exactly one kind
(image), so a column that's always `"image"` records nothing. Re-add it
the day a second kind ships, not before (same "don't build the branch
until there's a second case" reasoning ADR 0010 applied to `channel`).

Migration: `assets` table, FK to `workspaces(id)` and `projects(id)`
(nullable), unique index `(workspace_id, sha256) WHERE deleted_at IS NULL`
(SPEC 6.2's own dedupe index, unchanged), and a partial index on
`(status)` for the worker's claim query — the same shape
`builds(status)` already uses, verified with `EXPLAIN ANALYZE` per
guardrail 19, not assumed.

### 3. Upload: bytes through `Forge.Api`, matching the existing convention — not SPEC 14.1's presigned flow

`POST /api/v1/workspaces/{ws}/assets` takes a JSON body
(`{ originalName, declaredMimeType, contentBase64 }`), the same shape
`PublishVersionEndpoint.PublishVersionRequest` already establishes for
bundle uploads. Handler does, **in this order, all synchronously in the
request**:

1. `declaredMimeType` must be one of the three allowlisted values
   (Decision 1) — `422` otherwise, naming the rejected type.
2. Decode base64, enforce a hard size cap (`10 MiB` — generous for a
   32x32-grid tileset or a character sheet per SPEC 11.2's own `grid`
   sizes, a real resource-abuse guard the same way `PublishVersionEndpoint`'s
   `MaxBundleBytes` is) — `413` otherwise.
3. **Quota check, computed live, not cached:** `SUM(size_bytes) FROM
   assets WHERE workspace_id = @ws AND deleted_at IS NULL`, compared
   against `workspace.StorageQuotaMb * 1024 * 1024`. A cached counter is
   exactly the kind of in-process state guardrail 18 rules out across N
   API replicas — this is one indexed aggregate query, not a hot path
   (uploads are inherently rate-limited and infrequent relative to reads).
   Over quota → `402`-shaped `Problem` naming the current usage, the
   quota, and the upgrade path (SPEC 23.5's own established pattern for
   plan walls, reused rather than inventing a second one).
4. `SHA256` the **original, undecoded bytes** — this hash is a dedupe key
   over opaque bytes, never a claim about what those bytes decode to, so
   computing it here (before any Function ever runs) is safe and lets a
   re-upload of an already-known file short-circuit with the existing
   `Asset` row instead of re-queuing processing.
5. Upload the original bytes, **unmodified and undecoded**, to a private
   `assets-quarantine` container at `{workspaceId}/{assetId}/original` —
   a container the CDN/public asset-serving path never reads from
   (Decision 6). `Forge.Api` never opens these bytes as an image; it only
   ever moves them as an opaque blob.
6. Write the `Asset` row with `Status = Pending`, return `202 { assetId }`.

**What `Forge.Api` deliberately never does:** decode, resize, sniff
magic bytes beyond the declared-type allowlist check, or otherwise
interpret the content of the uploaded bytes. `Forge.Api` is the trusted,
session-bearing, database-connected process handling *every* tenant's
authenticated traffic — it is precisely the process T6's own threat table
entry says must not be where a decoder runs. This is the actual meaning
of "isolated worker" from the existing THREAT-MODEL.md row, made
concrete: isolation means *which process*, not a sandbox flag on the
same process.

Rate limiting: `WithRateLimit("assets-upload", RateLimitKeyStrategy.User,
...)`, a distinct policy from the general `"api"` one `PublishVersionEndpoint`
uses — uploads carry a real cost (Blob write, eventual Function
processing) an ordinary read doesn't, and deserve their own budget rather
than sharing one with cheap GETs.

**Named gap, not hidden:** SPEC 14.1's presigned-direct-to-Blob flow
avoids routing potentially-large bytes through `Forge.Api` at all, which
is a real efficiency win once upload volume justifies it. Deferred for
the same reason ADR 0010 deferred the shared cross-game `engine.{hash}.js`
CDN cache: real, identifiable follow-on work, not a correctness gap — the
base64-through-API path is correct and safe today, just not maximally
efficient at scale.

### 4. Processing: `Forge.Functions.Assets`, the same claim/orchestrate shape as `Forge.Functions.Scan`/`Forge.Functions.Build`

An `AssetOrchestrator.ProcessNextAsync`, unit-testable against a real
Postgres Testcontainer with no Functions Worker dependency, mirroring
`ScanOrchestrator`/`BuildOrchestrator`:

1. `AssetScanner.ClaimNextAsync` — the same optimistic
   `UPDATE assets SET status='processing' WHERE id = (SELECT id FROM
   assets WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE
   SKIP LOCKED) RETURNING *` pattern `PendingVersionScanner`/`BuildScanner`
   already use, for the identical "N worker instances, no double-processing"
   reason.
2. Download the quarantined original bytes from Blob.
3. **Cheap pre-check before any full decode:** `Image.Identify(stream)`
   (SixLabors.ImageSharp's header-only metadata read — it parses just
   enough of the file to report declared width/height without allocating
   or decoding pixel data) against a hard cap, matching SPEC 14.3's own
   atlas-size reasoning: **4096×4096 declared dimensions rejects
   immediately**, before any pixel buffer is ever allocated. This is the
   concrete defense against a decompression-bomb variant of T6/T13 (a
   small file whose *declared* dimensions would allocate gigabytes) —
   the check that has to happen before the expensive operation, not
   after it's already run.
4. **Full decode and re-encode, using SixLabors.ImageSharp** — a
   fully-managed, pure-C# image codec library with **no native/unmanaged
   code in the decode path**. This is the specific answer to "what
   decodes untrusted bytes": T6's CWE is CWE-787, out-of-bounds write —
   a memory-safety bug class that requires memory-unsafe code to exist at
   all. A native decoder (`libpng`/`libjpeg`/`libwebp` via P/Invoke, or a
   shelled-out `ffmpeg`/`ImageMagick` subprocess) carries that risk by
   construction, however well-audited the library; a managed .NET decoder
   cannot have an out-of-bounds *write* in the CLR's sense — a malformed
   input can throw a managed exception (caught in step 6) but cannot
   corrupt process memory the way a C decoder buffer overflow can. This
   is the single highest-leverage decision in this ADR and the reason it
   gets argued explicitly rather than picked implicitly by whichever
   library autocompletes first: **choosing memory safety over decoder
   maturity/format coverage is a deliberate trade**, made once, in
   writing, not a default. ImageSharp supports the three allowlisted
   formats (PNG, JPEG, WebP) natively. Runs inside `Forge.Functions.Assets`'s
   own process — no network egress required for decode (matches T6's
   "no network egress" control; nothing here ever calls out), fresh
   Function invocation per job (Consumption/Premium plan's own isolation,
   the same "fresh container per job" property THREAT-MODEL.md's trust
   boundary diagram already claims for this worker class).
5. Re-encode to PNG at the original resolution (WebP variant generation —
   SPEC 14.2's `opt.webp`/`thumb.webp` outputs — deferred alongside the
   rest of SPEC 14.2's per-kind table; PNG alone is what E4's Art Pack
   resolution needs to actually render something). The re-encoded bytes
   are **new bytes ImageSharp itself produced from decoded pixel data**,
   not the uploaded bytes copied or transcontainered — this is the
   "re-encode, never pass-through" half of T6's control, and it buys a
   second, independent property beyond decoder safety: whatever the
   uploaded byte stream actually was — a polyglot file, a PNG with
   trailing non-image data appended, anything a naive "just copy it to
   the public bucket" implementation would ship unexamined — the asset a
   player's browser ever receives is provably nothing but the pixels
   ImageSharp decoded, re-serialized as a clean PNG.
6. On success: upload the re-encoded PNG to a **public** `assets`
   container at `{workspaceId}/{assetId}/opt.png`, set
   `ProcessedBlobPath`, `Width`/`Height` from the real decoded image,
   `Status = Ready`, `CompletedAt`.
7. On failure — `ImageSharp` throws `UnknownImageFormatException`/
   `InvalidImageContentException` for a corrupt or non-image file, or the
   dimension pre-check in step 3 rejects it — mark `Status = Failed` with
   a creator-facing `ErrorMessage` ("this file isn't a valid PNG/JPEG/WebP
   image" / "image dimensions exceed the 4096×4096 limit"), never the raw
   exception text (guardrail 5/CLAUDE.md 5.5's copy rules: what happened,
   why, what to do next — "corrupt file" and "try a smaller image" are
   both real next steps; a stack trace is not). Distinct from a **harness**
   failure (Blob unreachable, the process itself crashed) the same way
   `SmokeGateHarnessException` is distinct from a real "blocked" verdict
   in `Forge.Functions.Scan` — a harness failure leaves the row `Pending`
   for retry rather than asserting `Failed` against a file that was
   actually fine.

**Named gap, not hidden:** packaging `Forge.Functions.Assets` for actual
Azure deployment (a real `.csproj` → Functions artifact with ImageSharp's
managed dependencies) is the same already-accepted category of gap ADR
0010 named for `Forge.Functions.Build`'s Node/`node_modules` packaging —
`AssetOrchestrator`/`AssetScanner` are fully testable against a real
Postgres Testcontainer and real ImageSharp calls on the CI runner's own
.NET SDK without solving Functions deployment packaging, the same way
`BuildOrchestratorTests` already proves C3 without solving Consumption-plan
Node packaging.

### 5. Quota accounting: original `SizeBytes`, not processed variant size

`workspaces.storage_quota_mb` is checked against `SUM(assets.size_bytes)`
— the **uploaded** size, not whatever ImageSharp's re-encode happens to
produce. Reasoning: quota exists to bound what a workspace can make Forge
store, and re-encode size is an implementation detail of *this* pipeline
version that could shrink or grow independent of anything the creator
did (switching PNG compression levels later, for instance) — pinning the
quota to what the creator actually uploaded keeps their bill/limit
predictable and independent of a future re-encoder change.

### 6. Blob layout: quarantine and public assets are physically separate containers

```
assets-quarantine/{workspaceId}/{assetId}/original   ← Forge.Functions.Assets read/write only, never public, never linked from any API response
assets/{workspaceId}/{assetId}/opt.png                ← public, cdn.forge.dev-eligible, content-addressed by assetId, immutable once Ready
```

Not two prefixes in one container: a container-level access boundary
means a future misconfiguration of the public container's access policy
cannot accidentally expose unprocessed, unvalidated bytes — the same
"survives a mistake somewhere else" reasoning ADR 0010 Decision 5 applied
to giving `Forge.Play` its own host rather than branching inside
`Forge.Api`. `DELETE /api/v1/assets/{id}` deletes both blobs synchronously
(quarantine copy has already served its only purpose once `Ready`) and
sets `DeletedAt`; a `Pending`/`Failed` row's quarantine blob is deleted
the same way once the row itself is deleted.

### 7. Content-Type served to players: derived from what was actually decoded, never the client's declared value

`GET` responses (and whatever E4's editor asset UI / Art Pack resolution
eventually serves through) send `Content-Type: image/png` because that is
what step 5 actually produced — never `DeclaredMimeType`, which is
attacker-controlled input, retained on the `Asset` row purely as a record
of what was claimed, not as anything downstream trusts. Combined with the
existing `SecurityHeaders` middleware's `X-Content-Type-Options: nosniff`
(already shipped, M0), this closes the classic content-type-confusion
path (upload something else, declare it `image/png`, hope a sniffing
client executes it as something else) independent of and in addition to
the decode-time validation in Decision 4 — two controls on the same
threat, not redundant, because Decision 4 assumes the decoder behaves
correctly and this one doesn't need to.

## Consequences

- **What this closes:** T6 goes from "primary control: isolated worker,
  re-encode never pass-through, resource caps" as an aspiration to a real,
  specific, named architecture — E2/E3 have exactly one way to implement
  it correctly rather than a design decision left to whoever writes the
  endpoint.
- **What stays out of scope, honestly:** audio, fonts, sprite-sheet frame
  detection, tileset autotile masks, WebP/thumbnail variant generation,
  SPEC 14.3's build-time atlas packing, and SPEC 14.1's presigned
  direct-to-Blob upload. Each is real, identifiable follow-on work.
- **A new dependency outside CLAUDE.md Section 2's pinned list:**
  `SixLabors.ImageSharp` (.NET, backend-only — never a JS/TS dependency,
  so it does not touch any Section 7 bundle-size budget). This is exactly
  the kind of addition Section 2 says needs asking first; this ADR is
  that ask, argued on the specific security property (memory safety)
  that made it the right choice for a threat this codebase already named
  before this ADR existed, rather than picked for convenience.
- **New indexes needed:** `assets(status)` partial index for the worker's
  claim query, `assets(workspace_id, sha256) WHERE deleted_at IS NULL`
  (already specified in SPEC 6.2, carried forward unchanged) — both
  shipped in the same migration per guardrail 19, not assumed.
- **Task split going forward (unchanged from the session plan):** E2
  (`Asset` entity + migration + the three `Forge.Api` endpoints:
  upload/list/delete, quota enforcement, the `assets-upload` rate-limit
  policy), E3 (`Forge.Functions.Assets`: `AssetScanner`/`AssetOrchestrator`,
  unit-tested against a real Postgres Testcontainer and real ImageSharp
  calls, mirroring `BuildOrchestratorTests`), E4 (wire `ProcessedBlobPath`
  into `@forge/art-pack`'s asset resolution as SPEC 11.4 priority-2
  "project-uploaded asset," plus the editor's own upload/browse UI with
  all six required states per CLAUDE.md 5.4).

## Addendum (E3): the specific ImageSharp version, and why it isn't the newest one

This Decision named `SixLabors.ImageSharp` but not a version. Actually
adding the package (E3) surfaced something this ADR's own diligence
missed the first time: reading the package's *license*, not just its API,
before pinning a version — the same category of check CLAUDE.md Section
2 exists for, just not one this ADR did explicitly at the time.

`SixLabors.ImageSharp` 3.0.0 onward ships under the **Six Labors Split
License**, not plain Apache-2.0 — confirmed by reading the actual
`LICENSE` file inside the 4.1.0 NuGet package, not assumed from the
package's reputation. Its terms: free under Apache-2.0 for open-source
consumers, transitive dependencies, non-profits, and for-profit *direct*
consumers under $1M USD annual revenue — everyone else owes a paid Six
Labors Commercial License. Forge is exactly the kind of consumer that
clause is written for: a commercial, for-profit platform, not incidental
open-source tooling, with the explicit ambition (CLAUDE.md's own "What
Success Looks Like") of being a real, sizable business. Picking the
newest ImageSharp version without reading this would have been
committing this business to a future license fee inside what looks like
an ordinary dependency choice — nobody reviewing "add an image library"
would think to re-check licensing on a later routine version bump either.

**Decision: pin to `2.1.13`, the latest release on the 2.1.x line, which
is still plain Apache-2.0** (confirmed against that specific package's
own nuspec, not inferred from the major version number alone — NuGet
license metadata can and does change between minor versions of a
license-restructuring library). This isn't a stale, abandoned line
traded for a license technicality: CVE-2025-27598, an out-of-bounds
write in the GIF decoder (CWE-787 — the exact vulnerability class this
whole ADR exists to defend against), was backported to 2.1.10, and
2.1.13 is later than that fix. The 2.1.x branch is actively
security-maintained, not merely old.

**Verified by actually running the code against both real API surfaces,
not assumed from documentation:**
- `Image.Identify()`'s null-vs-throw contract differs between the two
  license eras — 4.1.0 throws `UnknownImageFormatException` for
  unrecognized bytes, while 2.1.13 returns `null`. `AssetRunner.Run()` is
  written against 2.1.13's actual behavior (confirmed with a real
  Node-free throwaway console app probing both versions side by side),
  not the newer version's.
- The decompression-bomb defense this ADR's Decision 4 step 3 claims —
  reading declared dimensions without allocating pixel data — was proven
  against a real, hand-crafted 57-byte PNG with a correct signature and a
  correct-CRC `IHDR` chunk declaring 50000x50000: `Image.Identify`
  reported the declared size in under 100ms with a memory delta under
  100KB. `AssetOrchestratorTests.Oversized_Declared_Dimensions_...`
  exercises the identical crafted bytes as a real xUnit test, not a
  restated claim.

**Re-evaluate this pin, not before:** if a future CVE affecting image
decoding is fixed only on the 3.x/4.x line with no 2.x backport, or if
Forge's own revenue situation changes the license calculus outright (at
which point purchasing the commercial license becomes the honest
alternative to silently staying on an unpatched pin). Until then, 2.1.x
is both the license-safe and the security-current choice — not a
trade-off between them.

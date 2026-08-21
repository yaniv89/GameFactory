# 16. AI-assisted art generation ("describe it")

## Status

Accepted.

## Context

This session's earlier work (L1-L5, plus the unplanned character/tile
fixes that followed) wired real, sourced photos into the fixture packs —
a genuine improvement over the flat-color/placeholder art that shipped
before, but sourcing depends on someone (today, the user) supplying raw
photos by hand. The explicit ask this ADR answers: let a creator inside
the editor **describe** what they want in plain language — "a mossy
dungeon floor tile," "a green goblin with a club" — and get real,
usable art back, without needing their own source photos.

This is genuinely new territory for Forge in two ways nothing already in
the repo covers:

1. **A creator's free-text description becomes input to an external,
   paid generative AI API.** Every existing external API call this
   codebase makes (Stripe, in `Forge.Infrastructure/DependencyInjection.cs`)
   is a *structured, code-constructed* request — Forge decides every field
   that goes to Stripe. This is the first time user-authored natural
   language flows into an external AI call at all.
2. **The output is untrusted bytes from a *new* external source**, same
   shape as `docs/adr/0012`'s "crafted asset exploits an image decoder"
   threat (T6, `docs/security/THREAT-MODEL.md`) — a generated image is
   just as untrusted as an uploaded one; nothing about "an AI made it"
   changes that.

### What already exists that this reuses

- **The claim/orchestrate worker pattern** (`BuildOrchestrator`/
  `ScanOrchestrator`/`AssetOrchestrator`, all three `docs/adr/0009`/
  `0010`/`0012`): an optimistic `UPDATE ... WHERE status = 'pending' ...
  FOR UPDATE SKIP LOCKED RETURNING *` claim query, fully testable against
  a real Postgres Testcontainer with no Functions Worker dependency. The
  same shape a fourth time, not a new pattern.
- **`docs/adr/0012`'s entire T6 answer** — quarantine container, cheap
  declared-dimension pre-check before full decode, fully-managed
  (ImageSharp, no native/unmanaged code) decode, re-encode never
  pass-through, public container only after re-encode. A Gemini-returned
  image is exactly as untrusted as a creator-uploaded one; it goes through
  the *identical* pipeline, not a parallel "trusted because it's ours"
  shortcut. This is this ADR's single most important reuse decision (see
  Decision 3).
- **`PlanGateRequirement`/`PlanGateHandler`** (`Forge.Api/Authorization`),
  already wired and consumed by `CreateBuildEndpoint`/`UploadAssetEndpoint`
  — the exact mechanism for "this workspace must be on a paid plan,"
  resolved server-side from `Workspace.Plan`, itself written only by
  verified Stripe webhook events (CLAUDE.md guardrail 4).
- **`RateLimitingMiddleware`/`RateLimitPolicies`** (`Forge.Api/RateLimiting`),
  `WithRateLimit(surface, keyStrategy, policy)` — reused verbatim with a
  new named policy and surface, matching `AssetUpload`'s own precedent.
- **The `IConfiguration["X:SecretKey"]` secret pattern** Stripe already
  uses (`Stripe:SecretKey`, `Stripe:WebhookSecret`) — the only secret
  pattern this codebase actually has today. CLAUDE.md 4.7 says "Azure Key
  Vault via managed identity"; in practice that means Key Vault is wired
  as an `IConfiguration` *source* in production (standard ASP.NET Core
  `AddAzureKeyVault`), which nothing in this repo currently configures —
  the same gap exists for `Stripe:SecretKey` today. This ADR does not
  invent a second secret-handling convention for one more key; it follows
  the one that exists.
- **This session's own Python art pipeline** (`tools/art-pipeline/*.py`)
  — `chroma_key_extract`'s spill-score algorithm and
  `character_sheet_extract`'s band-detection/east-mirroring are the
  *reference implementation* for what "process this into a pack-ready
  asset" means, but they are dev-time CLI tools invoked by hand, not
  production server code. Decision 4 below is explicit about why they
  cannot simply be shelled out to from `Forge.Functions.ArtGen`.

## Decision

### 1. Scope: tiles and props only, v1 — character sheets and VFX strips explicitly deferred

A single generated image can become a pack-ready **terrain tile** (no
transparency needed — the whole frame is the asset, `docs/adr/0014`'s own
observation about terrain tiles) or a **prop** (one chroma-keyed subject
on a magenta background, `docs/adr/0014`'s `ArtPackProp`) from *one*
generation call. A **character sheet** needs a coherent 4-direction pose
grid from a *single* prompt — this session's own hard-won lesson
(`character_sheet_extract.py`'s docstring) is that even real, professionally
generated source photos got this wrong more often than right (missing
east row, duplicate poses), and an AI generating cold from one text prompt
has no reason to do better. **v1 generates tiles and props only.**
Character/creature sheets and VFX/facing strips (`ArtPackVfx`/
`ArtPackWagon`) are named, real follow-on work — most likely a
multi-call generation strategy (one call per facing, stitched
server-side) rather than hoping a single image comes back correctly
gridded — not attempted here and not silently downgraded to "works most
of the time."

### 2. Two-stage generation, both calls server-side, never client-side

```
creator's free-text description
        |
        v
[Forge.Api, synchronous]  Gemini text call: expand into a real
                           generation prompt (style/perspective/background
                           conventions fixed by Forge, not the creator —
                           see Decision 5) -> returns the expanded prompt
                           to the creator for a quick look before any
                           image-generation cost is spent
        |
        v  (creator confirms)
[Forge.Functions.ArtGen,   Gemini image-generation call(s): N variations
 async]                    -> raw bytes, untrusted, same as an upload
        |
        v
[Forge.Functions.ArtGen]   Decision 3's pipeline: decode-safety pass,
                           then category-specific processing (crop/resize
                           for a tile, chroma-key + crop-to-content for a
                           prop) -> pack-ready PNG(s)
```

The expansion call is synchronous in `Forge.Api` deliberately: it is fast
(a few seconds), lets the creator see and reject a bad expansion *before*
any image-generation cost is incurred, and produces the thing Decision 6's
rate limit/budget check actually gates. The image-generation call is
async in a worker for the same reason every other slow/expensive external
call in this codebase already is (`docs/adr/0010`'s build worker,
`docs/adr/0012`'s asset worker): `Forge.Api` does not block a request
thread on an external network call with unpredictable, potentially
20-30+ second latency.

**Both calls' API key**: one configuration value,
`ArtGeneration:GeminiApiKey`, read exactly the way `Stripe:SecretKey` is
today. Never included in any response body, never accepted as a
request parameter from the client (a request that tried to pass its own
`apiKey` or `model` override is a validation error, not a passthrough —
closes the obvious "client picks which key/model bills me" hole before it
can exist).

### 3. The generated image goes through docs/adr/0012's *existing* untrusted-asset pipeline, unmodified — not a parallel "AI output is safe" shortcut

This is the decision this ADR most wants to get right, stated plainly:
**a byte stream from Gemini's image API is exactly as untrusted as a byte
stream from a creator's upload form.** Nothing about its origin changes
T6 (`docs/security/THREAT-MODEL.md`) — a malformed or hostile response
(whether from a compromised/spoofed endpoint, a provider bug, or a
future-model edge case nobody has hit yet) gets the identical treatment
Decision 4 of `docs/adr/0012` already specifies: land in the private
quarantine container first, `Image.Identify()`-only declared-dimension
check before any full decode, decode via the same fully-managed
ImageSharp path (no native decoder in the path, memory-safety by
construction), re-encode — never pass-through — before anything public
happens. `Forge.Functions.ArtGen` calls into the *same*
`AssetOrchestrator`/`ImageDecodeService` machinery `Forge.Functions.Assets`
already has rather than re-implementing image decode safety a second
time.

### 4. Category-specific post-processing is a new, managed (C#/ImageSharp) port — not a Python subprocess

`tools/art-pipeline/chroma_key_extract.py`'s spill-score algorithm is the
correct one (this session verified it against real photos, including a
mid-implementation correctness fix after the naive Euclidean-distance
version failed visually) and gets ported to C#/ImageSharp rather than
reimplemented from scratch or, worse, invoked by shelling out to a Python
interpreter from `Forge.Functions.ArtGen`. Shelling out to Python would
mean feeding externally-sourced, not-yet-decode-verified bytes to a
second, unmanaged-language process — precisely the "isolation means which
process, not a sandbox flag on the same process" reasoning `docs/adr/0012`
already argued, undermined by routing back through a subprocess anyway.
The port runs *after* Decision 3's decode-safety pass, operating on
already-re-encoded, already-verified pixel data — algorithmically the
same spill-score math, C# types instead of numpy arrays.

**Named gap:** the port covers `chroma_key_extract`'s core algorithm
(spill score, alpha unmixing, crop-to-content) since props need it now.
`character_sheet_extract`'s band-detection/mirroring logic is not ported
in this ADR's scope — it has no v1 caller (Decision 1).

### 5. The expansion prompt is Forge's own template, not the creator's raw text — the actual prompt-injection defense

The Gemini text call's *system instruction* fixes Forge's own generation
conventions (top-down/isometric pixel-art style, transparent/magenta
background for a prop, seamlessly tileable composition for a tile,
existing pack's own art style as a steering reference where one is
active) as instructions the model follows; the creator's free text is
passed as clearly-delimited *user content* within that call, using the
Gemini API's own system-instruction/user-content separation rather than
string-concatenating everything into one blob (the classic prompt-injection
setup this avoids).

**Why this is bounded even if injection partially succeeds:** unlike
every other untrusted-input threat in `docs/security/THREAT-MODEL.md`
(module code, dialogue text, uploaded archives), nothing downstream ever
treats either model's *text* output as code, an instruction to a
privileged system, or anything except a string passed to the next stage
as more user content. The worst realistic outcome of a creator crafting a
prompt to manipulate the expansion step is: a weird, off-brief, or
policy-declined image — which the creator can only ever apply to *their
own* pack, and which still goes through Decision 3's identical untrusted-
decode pipeline regardless of what the prompt said. There is no path from
"the expansion model was tricked" to "arbitrary code ran" or "another
workspace's data leaked" — the blast radius is contained by construction,
not by a moderation layer this ADR would otherwise need to build. Content
that Gemini's own safety filtering declines is surfaced as a real,
specific `Failed` state (Decision 6) — Forge does not attempt a second,
independent moderation pass on top of the provider's own in v1.

### 6. Data model, rate limiting, and cost control

```csharp
public enum GenerationStatus { PendingExpansion, AwaitingConfirmation, Generating, Ready, Failed, Declined }

public sealed class GenerationRequest
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid RequestedByUserId { get; set; }
    public string UserPrompt { get; set; } = "";          // raw, as typed -- retained for audit, never itself sent as a privileged instruction
    public string? ExpandedPrompt { get; set; }             // set after the synchronous expansion call
    public ArtGenCategory Category { get; set; }             // Tile | Prop (Decision 1)
    public GenerationStatus Status { get; set; }
    public string? ErrorMessage { get; set; }                 // creator-facing, never a raw exception (CLAUDE.md 5.5)
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class GenerationVariation
{
    public Guid Id { get; set; }
    public Guid GenerationRequestId { get; set; }
    public string ProcessedBlobPath { get; set; } = "";       // public, post-Decision-3/4 pipeline output
    public bool Selected { get; set; }                        // the creator's pick, if any -- becomes the pack asset
}
```

`POST /api/v1/workspaces/{ws}/projects/{p}/art-generation` (expansion,
synchronous) and `POST .../art-generation/{id}/confirm` (kicks off async
image generation) both:

- `.RequireAuthorization("workspace:write")` — same as every other
  workspace-mutating endpoint.
- `.RequireAuthorization` via a new `PlanGateRequirement(WorkspaceResourceKind.Workspace, "workspaceId")` reused verbatim — **generation is Pro/Studio only in v1**, the same "Free tier gets a clear 402 with an upgrade path" wall `docs/SPEC.md` Section 23.5 already establishes for export/publish, applied here because this is the first feature with a real per-call *external* dollar cost, not just Forge's own compute.
- `.WithRateLimit("art-generation", RateLimitKeyStrategy.User, RateLimitPolicies.ArtGeneration)` — a new named policy (`Limit: 10, Window: TimeSpan.FromHours(1)`, matching the "generous for real use, a real ceiling against abuse" reasoning `AssetUpload`'s own policy already uses), a distinct policy from `assets-upload` because the per-call cost profile is completely different (an external paid API call vs. a local Blob write).
- **A live per-workspace-per-day budget check**, computed the same way `docs/adr/0012` Decision 3 computes storage quota — `COUNT(*) FROM generation_requests WHERE workspace_id = @ws AND created_at > @todayStart AND status NOT IN ('Failed','Declined')`, not a cached counter (guardrail 18 — no in-process state a load balancer can't redistribute). The request-rate limiter alone only bounds *burst rate*, not total daily spend; this is the second, independent control on the same cost risk, the same "two controls on one threat, not redundant" reasoning `docs/adr/0012` Decision 7 used for content-type confusion.

## Consequences

- **New threat-table row** (`docs/security/THREAT-MODEL.md`), added by
  this ADR since it names a genuinely new trust boundary/input source
  (CLAUDE.md 6.5) — N7 does the full review pass against it, this ADR
  states the boundary exists:

  | ID | Threat | CWE | Severity | Primary control |
  |---|---|---|---|---|
  | T18 | Creator's free-text art-generation prompt manipulates the expansion step, or a generated image is a hostile/malformed byte stream | CWE-1427 (prompt injection) / CWE-787 (via T6's existing control) | Medium | System-instruction/user-content separation (Decision 5), bounded blast radius (no downstream code-execution of any model output), generated images routed through `docs/adr/0012`'s existing untrusted-decode pipeline unmodified (Decision 3) |

- **What this unlocks:** a creator with zero source photos of their own
  can still get real, usable tile and prop art — the actual ask this ADR
  exists to answer.
- **What stays out of scope, honestly:** character/creature sheets, VFX
  and facing strips (Decision 1); any in-house content-moderation layer
  beyond the provider's own filtering (Decision 5); Free-tier access
  (Decision 6 — Pro/Studio only in v1, revisit if a metered
  pay-per-generation model is ever wanted instead of a flat plan wall).
- **A new dependency outside CLAUDE.md Section 2's pinned list:** a
  Gemini API client. Backend-only (`Forge.Api`/`Forge.Functions.ArtGen`),
  so it never touches a JS/TS bundle-size budget — same "this ADR is the
  ask" framing `docs/adr/0012` used for ImageSharp. License and specific
  package/SDK version get the same explicit check `docs/adr/0012`'s own
  addendum did for ImageSharp, at implementation time (N2), not assumed
  here.
- **Task split going forward (unchanged from the session plan):** N2
  (the two endpoints + `GenerationRequest` entity/migration + plan
  gate/rate limit/budget wiring), N3 (`Forge.Functions.ArtGen`: the async
  image-generation call + claim/orchestrate lifecycle), N4 (the
  ImageSharp port of `chroma_key_extract`'s algorithm, wired as the
  category-specific post-processing step), N5 (editor UI), N6 (this
  ADR's Decision 6 is the plan; N6 is verifying it end to end and tuning
  the actual limits against real usage), N7 (full security review against
  the new T18 row), N8 (real end-to-end exit criteria).

## Addendum (N6): the daily budget is plan-tiered; the rate limit stays flat

Decision 6's original `DailyBudget = 20` was one flat number for every
Pro+ workspace — correct as a v1 placeholder, but it left Pro and Studio
paying the identical volume ceiling despite `docs/SPEC.md` Section 23.2
already establishing that these two tiers should differ materially on
exactly this kind of AI-generation cost guardrail (the sibling "wizard
generations" capability there splits 100/month Pro vs. 500/month
Studio — a 5x spread for the higher-priced tier). N6 carries that same
shape over to art generation's own daily budget:
`CreateGenerationRequestEndpoint.DailyBudgetByPlan` — `{ Pro: 20, Studio:
100 }` — read from the requesting project's own `Workspace.Plan` in the
same query that already resolves cross-tenant ownership, not a second
round trip. Still a live `COUNT`, not a cached counter (guardrail 18
unchanged); still "this session's own call, not lifted from a table in
the spec" the same way the original flat number was — a launch default
to re-cut once real usage exists for this specific feature, since no
usage data for it exists yet to tune against honestly.

`RateLimitPolicies.ArtGeneration` (the burst-rate limiter, `Limit: 10,
Window: 1 hour`) deliberately stays flat across both tiers — see that
policy's own doc comment. The two controls guard different failure
modes: the rate limit stops one account hammering the endpoint in a
short window regardless of plan, while the daily budget is the one that
actually reflects what a Studio workspace is paying more to get. Scaling
the rate limit too would blur that distinction for no real benefit — a
Studio account doesn't need to burst *faster*, just spend *more* per day.

Deliberately left alone in this pass: `Workspace.StorageQuotaMb` (the
quota `SelectGenerationVariationEndpoint` already reuses verbatim from
`docs/adr/0012`) is still one flat 500 MB regardless of plan — a real
gap, but a pre-existing one that predates this feature and affects every
asset a workspace holds, not just AI-generated ones. Tiering it belongs
with M5's own billing work, not folded into this ADR's scope.

# Proposal 0001: Guided Creation and the Design Marketplace

Status: **Draft for decision** — not yet accepted, not yet scheduled.
Date: 2026-08-05
Supersedes: `docs/SPEC.md` Section 22 open question 6 ("how opinionated should the RPG template be?")

---

## 0. The honest market read (start here)

Before claiming anything is novel, here is what already exists and is **not** a differentiator:

| Idea | Who already does it | Verdict |
|---|---|---|
| "Describe your game, AI generates it" | Rosebud AI, Astrocade, Ludus, and a growing list | **Crowded.** Prompt-to-game is table stakes by now, not a moat. |
| AI-generated NPC dialogue | Inworld, Convai, character.ai-adjacent tooling | Commodity. |
| Template/genre pickers | RPG Maker, GDevelop, Construct, every engine's "new project" dialog | Ancient. |
| AI-assisted asset generation | Scenario, Layer, Leonardo, dozens more | Commodity, and licensing-hostile. |

**So a wizard that generates a game is not the idea.** If we ship only that, we are the twentieth prompt-to-game tool and we compete on model quality, which we do not control.

What *is* defensible is already written into `docs/SPEC.md` Appendix B: real-time collaboration, a **sandboxed and measured** plugin ecosystem with first-party monetization, and contract-based art pack swapping. The proposal below is an attempt to make the wizard *feed* that moat instead of being a separate feature bolted next to it.

The genuinely new mechanic is in §2.2 and §2.3. Everything else is supporting structure.

---

## 1. What the user asked for

Verbatim intent, captured from the session:

> Multiple options to choose how you want your game to be — e.g. 2D or 3D, what kind of genre, first person or third person, open world or limited area per mission, realistic or cartoonish, number of missions and the type of missions (puzzle, delivery, …) per mission, type of story wanted, theme wanted, etc.

Split into two categories, because they have very different costs:

**Category A — content and structure choices (in scope).** Genre flavor, theme, tone, art direction, story shape, mission count, per-mission type, difficulty curve, length. These are choices *within* an engine we already build. They cost content and tooling work, not architecture.

**Category B — engine-architecture choices (out of scope for now).** 2D vs 3D, first-person vs third-person, open-world vs mission-gated. `docs/SPEC.md` Section 1.3 lists 3D as an explicit non-goal ("order of magnitude more asset pipeline, physics and performance work") and Section 2 picked top-down 2D deliberately as the beachhead. Section 21 risk R5 ("Godot or Construct ships an equivalent") is a direct warning against generality. Offering these as checkboxes means building and maintaining parallel rendering, physics, camera, and asset pipelines forever.

**Recommendation:** ship Category A now; treat Category B as a separate product decision with its own ADR, revisited after M6. §5 has the specific re-entry criteria rather than a vague "later."

---

## 2. The proposal: the Brief is a contract, not a prompt

### 2.1 Pillar 1 — the Forge Brief (the wizard's real output)

The wizard does **not** output a game. It outputs a **Brief**: a small, human-readable, editable, diffable JSON document describing design intent.

```jsonc
// brief.json — lives in the project root, next to project.json
{
  "schemaVersion": 1,
  "theme": { "setting": "coastal-fishing-village", "tone": "warm-melancholy", "rating": "everyone" },
  "story": { "shape": "return-home", "protagonistRole": "returning-child", "acts": 3 },
  "art": { "direction": "cartoonish", "palette": "muted-warm", "requiredProfiles": ["forge/topdown-rpg-basic@1"] },
  "missions": [
    { "id": "m1", "type": "delivery",  "teaches": ["movement", "npc-interaction"], "targetMinutes": 4 },
    { "id": "m2", "type": "puzzle",    "teaches": ["inventory", "keys-and-locks"], "targetMinutes": 6 },
    { "id": "m3", "type": "escort",    "teaches": ["combat-basics"],               "targetMinutes": 5 }
  ],
  "requires": {
    "capabilities": ["dialogue", "inventory", "puzzle-logic", "escort-ai"],
    "packProfiles": ["forge/topdown-rpg-basic@1", "forge/topdown-rpg-interior@1"]
  }
}
```

Why a document and not a prompt:

- **Editable after the fact.** A prompt is a one-shot; a Brief is a living file the creator keeps tuning. "Change mission 2 from puzzle to stealth" is a one-line edit, not a re-roll of the whole game.
- **Diffable.** `git diff` on a Brief shows exactly what changed about the *design*. Nothing in this market does that.
- **Portable and forkable.** A Brief is a few KB. It can be shared, sold, remixed, and templated. This is the WordPress analogy holding: the Brief is to a Forge game what a starter theme + content plan is to a WordPress site.
- **The resolver target.** See §2.2 — this is the load-bearing part.

**Reverse direction too:** point the wizard at an existing project and it extracts a Brief. That gives us template harvesting from real games, and automatic marketplace tagging, for near-free once the forward direction works.

### 2.2 Pillar 2 — the Brief resolves against the marketplace (the actual novel mechanic)

`requires.capabilities` and `requires.packProfiles` are not decoration. They are a **dependency specification for design intent**, resolved by the same registry resolver that already exists in `docs/SPEC.md` Section 13.4.

```
Brief.requires.capabilities: ["dialogue", "inventory", "puzzle-logic", "escort-ai"]
        │
        ▼  registry resolve (existing endpoint, extended)
  ┌─────────────────────────────────────────────────────────┐
  │ dialogue      → @forge/dialogue@1.8.2        ✓ satisfied │
  │ inventory     → @forge/inventory@2.0.1       ✓ satisfied │
  │ puzzle-logic  → @acme/puzzle-kit@0.4.1       ✓ satisfied │
  │ escort-ai     → (nothing satisfies this)     ✗ GAP       │
  └─────────────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                                          logged to the Demand Board
```

This turns the marketplace from a catalog you browse into a **resolver target you declare against**. npm for game design intent. That framing is, as far as I can establish, not something any comparable platform does — Unity Asset Store, RPG Maker's plugin scene, and the WP plugin repo are all browse-and-hope.

### 2.3 Pillar 3 — the Demand Board (this is the $1M mechanic, if any of them is)

Every unsatisfied capability in every Brief, across every creator, is a logged, aggregated, public signal.

```
FORGE DEMAND BOARD — capabilities creators asked for and could not get
──────────────────────────────────────────────────────────────────────
  escort-ai            1,240 Briefs   0 modules   ← nobody has built this
  fishing-minigame       890 Briefs   1 module    (rated 2.1★, unmaintained)
  farming-crops          760 Briefs   3 modules   ✓ well served
  stealth-detection      610 Briefs   0 modules   ← nobody has built this
```

Why this matters more than it looks:

1. **It solves R1, the only risk rated *Fatal* in `docs/SPEC.md` Section 21** ("ecosystem never forms"). The cold-start problem for a plugin marketplace is that authors do not know what to build and creators do not know what to ask for. A demand board closes that loop with data instead of guesswork.
2. **It is a recruiting tool.** "1,240 creators want this and nobody has built it" is a far stronger pitch to a plugin author than "please come build things on our new platform." It converts Section 20 Phase 2's "recruit 15–25 authors and support them personally" from cold outreach into inbound.
3. **It compounds.** More creators → sharper demand signal → more authors → fewer gaps → more creators. That is the flywheel, and it runs on data we generate for free as a byproduct of the wizard.
4. **It is hard to copy without the Brief.** A competitor with a prompt-to-game tool has prompts, not structured capability declarations. They cannot aggregate what they never modeled.

### 2.4 Pillar 4 — Mission Kits (a third marketplace SKU, and a much larger author pool)

Today `packages.kind` in `docs/SPEC.md` Section 6.2 is `module | artpack | template`. Add **`missionkit`**: a packaged, parameterized mission — structure, beats, dialogue skeleton, objectives, win/lose conditions — that slots into a Brief.

The business insight: **a Mission Kit does not require the author to write code.** A designer or a writer can build and sell one. That expands the author pool from "people who can write sandboxed TypeScript" to "people who can design a good fetch quest," which is a far bigger population and a far better fit for the 80%-Creator / 5%-Author split in Section 1.4.

It also gives the marketplace a low-price, high-volume SKU tier, which is what actually makes a marketplace feel alive early on.

### 2.5 Pillar 5 — measured design (extending an existing differentiator)

`docs/SPEC.md` Section 16.2 already publishes **measured frame cost and bundle size** per module and calls it "a differentiator no comparable marketplace offers." Extend the same principle from *performance* to *design quality*, using the play telemetry we already collect (Section 17):

```
@acme/rescue-the-cat  —  Mission Kit  —  $4
  ★ 4.2 (312 ratings)
  ─────────────────────────────────────────────
  Completion rate ......... 73%   (median 61%)
  Median play time ........ 4m 12s (author says 5m)
  Drop-off concentration .. 18% quit at the second lock puzzle
  Frame cost .............. 0.3 ms  ✓ well under budget
```

Nobody sells game content with a completion-rate label on it. This is the same "measure it and publish it" instinct that the spec already commits to, applied to the one axis creators actually care about.

**Backed by determinism, not vibes.** Section 8.2 mandates a fixed timestep specifically so replays are verifiable (Section 17 uses this for leaderboard anti-cheat). The same property gives us an **auto-playtest solver**: run a mission headlessly and assert it is completable at all. "Your mission 3 is unwinnable because the key spawns behind the locked door" is a real, common, expensive bug in RPG Maker games, and we can make it a build-time error.

---

## 3. Security posture (non-negotiable, and a differentiator in itself)

Any generation feature here must obey `CLAUDE.md` Section 1.1:

- **The model emits data, never code.** Wizard output is JSON validated against a schema — scenes, entity definitions, dialogue graphs, data-table rows. Never JavaScript, never a module bundle, never anything that reaches an interpreter as source.
- **Creator-authored logic compiles to the restricted bytecode VM** (`docs/SPEC.md` Section 10.2 Option 3), which is exactly what the graph editor already targets. Generated graph nodes go through the same path with no new trust boundary.
- **No new trust boundary is introduced**, so `docs/security/THREAT-MODEL.md` needs an input-source entry for generated content but no new boundary in the diagram.
- Generated text is rendered through `@forge/richtext` like all other user content. No exceptions for "our own" generated text — it is model output, which is untrusted input.

This is worth stating publicly as a product claim: competitors that let an LLM write JavaScript into a shipped game have handed the model an arbitrary-code-execution path into every player's browser. We structurally cannot, and that is a marketing asset as well as an engineering one.

---

## 4. Where this lands in the milestone plan

Deliberately minimal disruption. Most of this rides on infrastructure the roadmap already builds.

| Piece | Milestone | Why there | New work? |
|---|---|---|---|
| **Brief schema** (`brief.json` + migrations) | **M3** (with the project document work) | A document-format decision. Cheap now, expensive to retrofit after projects exist in the wild. This is the one item with real "do it early or regret it" pressure. | Small — a schema + validator |
| Brief → project scaffolding (deterministic) | M4 | Needs the editor and scene canvas to have something to scaffold into | Medium |
| Wizard UI (the six-state, keyboard-first flow) | M4 | It is an editor view; Section 5.4 states apply | Medium |
| LLM-assisted Brief authoring | M4, behind a flag | Optional layer on top of a wizard that must work without it | Small |
| `missionkit` package kind | M6 | Registry already has a `kind` column and a resolver | Small — mostly registry + validation |
| Brief → capability resolution | M6 | Extends the existing `/registry/resolve` endpoint | Small |
| **Demand Board** | M6 | Needs resolution running at volume to produce signal | Medium |
| Auto-playtest solver | M6 | Needs the build pipeline and deterministic replay | Medium |
| Design telemetry on listings | M7 | Needs play services live | Small — mostly a query + a UI |

**Only one thing needs a decision now: the Brief schema in M3.** Everything else can be decided when its milestone arrives. That is the actual scheduling ask in this document.

---

## 5. Category B (3D, camera, open-world): the re-entry criteria

Not "later" — here is what would have to be true to reopen it:

1. M6 exit criterion met (a real 15-minute RPG published and exported), **and**
2. The Demand Board shows sustained, quantified demand for the axis in question, **and**
3. An ADR that honestly costs the parallel pipeline — renderer, physics, camera, asset pipeline, art pack contract, and the perf budgets in Section 7, all of which are written for 2D.

Absent all three, adding a 3D checkbox turns Forge into a worse Godot, which Section 21 R5 names as the specific way this project loses.

---

## 6. Money

### 6.1 LLM costs — accurate as of 2026-08-05

Current published rates per million tokens:

| Model | Input | Output |
|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 |
| Claude Sonnet 5 | $3.00 ($2.00 intro through 2026-08-31) | $15.00 ($10.00 intro) |
| Claude Haiku 4.5 | $1.00 | $5.00 |

Modifiers that matter a lot here:

- **Prompt caching**: cache reads cost ~**0.1×** base input. Cache writes cost **1.25×** (5-min TTL) or **2×** (1-hour TTL). Our wizard has a large fixed prefix (schemas, art-pack profiles, capability vocabulary) and a small variable suffix (the creator's answers) — close to the ideal caching shape. Assume near-full cache hits on input after the first call in a session.
- **Batch API**: **50% off** all token usage, up to 24h turnaround. Useless for the interactive wizard, genuinely useful for the auto-playtest solver and any bulk regeneration.

**Per-generation estimate** (one mission's worth of structure + dialogue skeleton: ~20K input mostly cached, ~10K output):

| Model | ≈ cost / generation | 20 generations (one creator session) |
|---|---|---|
| Opus 5 | ~$0.26 | ~$5.20 |
| Sonnet 5 (intro pricing) | ~$0.10 | ~$2.00 |
| Haiku 4.5 | ~$0.05 | ~$1.00 |

⚠ **Output tokens dominate — roughly 95% of the cost.** Caching helps the input side almost completely and barely moves the total. The lever that actually controls spend is output length and model tier, not caching.

⚠ **This is the one feature in the entire product with a per-use marginal cost.** Everything else in Forge is fixed infrastructure. A free tier with an uncapped wizard is an unbounded liability — a single enthusiastic creator can burn $20 in an afternoon. Whatever we ship needs a generation quota from day one, and probably a Haiku/Sonnet tier for free users with Opus reserved for paid.

### 6.2 Infrastructure and operations

⚠ **These are planning-grade estimates, not quotes.** I have not priced them against current Azure/vendor rate cards, and they should be verified before any of them enters a budget.

| Line | Rough monthly | Notes |
|---|---|---|
| Azure: Postgres, Redis, Blob, CDN, App Service, Functions (staging + small prod) | $300–900 | Grows with published-game bandwidth, which is the wildcard |
| CDN egress for published games | Highly variable | The real free-tier cost risk. One viral game can dwarf everything else on this table. Section 22 open question 4 already flags this |
| Chromatic (visual regression, required by Section 9.1) | $0–150 | Free tier exists; paid starts around $150 |
| Real-device farm for the Section 7.3 benchmark matrix | $200–500 | BrowserStack/Sauce-class. **Required** — Section 7.3 mandates fixed devices, not CI runners |
| Stripe Connect | 2.9% + $0.30 per transaction, plus Connect fees | Passed through to authors per Section 16.1; verify current Connect account/payout fees |
| Domains, TLS, email, error tracking | $50–150 | |

**One-time / milestone-gated:**

| Line | Rough | Notes |
|---|---|---|
| External security audit of the sandbox | $15,000–50,000 | `docs/SPEC.md` Section 21 R3 requires this before Phase 3. Wide range because scope varies enormously; this is the single largest non-salary line |
| Seed content: first-party art packs + Mission Kits | $5,000–20,000 | Section 21 R1's "fund the first 20 modules directly if needed." A marketplace with an empty Demand Board and no Mission Kits does not demonstrate the flywheel |

### 6.2.1 Bootstrap phase (solo/home, no live users yet)

§6.2's table is the *scaled* picture — it assumes real traffic and is the wrong thing to budget against on day one. This project is being built solo, from home, before any user exists. Nearly every line above is deferred, not incurred:

| Phase | Rough monthly | What it actually buys |
|---|---|---|
| Building the engine + editor (M1–M4), no live deployment | **$0–30** | Postgres/Redis/Blob run locally in Docker ($0); GitHub Actions free tier (2,000 min/mo) covers a solo repo; Chromatic free tier (5,000 snapshots/mo); a domain (~$1/mo); Claude API spend from personally testing the wizard (~$5–20/mo) |
| First live beta, ~10–100 real users | **$100–250** | One small VM or a consumption-tier container host ($20–50); managed Postgres burstable tier or a free/starter hosted tier ($0–25); Redis free tier ($0–10); blob storage at this scale (a few dollars); wizard LLM calls at light beta usage ($50–150) |

The real-device farm, the paid Chromatic tier, the $15–50K security audit, and the $5–20K content-seeding budget in §6.2 stay exactly where they are: gated to M6/M7, funded only once there's a product and traffic worth protecting. None of them are a pre-condition for building or for the first beta. The §6.2 figures ($550–1,700/mo fixed, scaling to $20K+/mo in LLM spend) become relevant only at the creator counts stated there — by which point they're funded by usage, not by savings.

### 6.3 What the flywheel actually earns

At Section 16.1's 80/20 split, platform revenue is 20% of marketplace GMV. Mission Kits are the interesting line because they are low-price and high-volume: 10,000 creators × 2 kits × $4 × 20% = $16K/mo. That is not a business on its own — it is a signal that the ecosystem is alive, which is what makes the subscription defensible. **The marketplace's job is to prove the platform is worth subscribing to, not to be the revenue.**

---

## 7. Honest assessment

- **"$1M idea" is not a property of an idea.** It is a property of execution plus distribution. What I can say is that Pillars 2 and 3 (Brief-as-resolver-target and the Demand Board) are the parts I could not find prior art for, and they attack the risk the spec itself rates *Fatal*. That is the strongest position in this document.
- **Pillars 1, 4, and 5 are good but more copyable.** A competitor could add a mission-kit SKU or publish completion rates. They would need the Brief format first to do the demand aggregation.
- **The biggest execution risk is that Briefs generate mediocre games.** A truthful diff and an honest completion-rate label are worth nothing if what comes out is boring. This needs real playtesting during M4, not a demo.
- **The second risk is cost discipline on generation.** See §6.1. It is the only unbounded-cost surface in the product.
- **What I do not know:** whether creators will actually declare capabilities up front rather than discovering them by browsing. The Demand Board's entire value rests on that behavior, and it is testable cheaply in Phase 0 with a clickable prototype — which `docs/SPEC.md` Section 20 already budgets for.

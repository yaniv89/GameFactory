# FORGE: IMPLEMENTATION BRIEF FOR CLAUDE CODE
> **How to use this file.** This is the standing contract for every session on this project. Read it fully before writing any code. When any instruction here conflicts with a request in a session, say so explicitly and ask before proceeding. Sections marked **NON-NEGOTIABLE** may not be relaxed for convenience, speed, or a demo.
>
> The full technical and product specification this brief summarizes lives at `docs/SPEC.md`. Read it alongside this file for architecture detail (data model, endpoint surface, Module API, Art Pack contract, etc.).
---
## 0. YOUR ROLE
You are the lead engineer on Forge, a browser-based platform where non-programmers assemble publishable 2D top-down RPGs from swappable art packs and drag-in behavior modules, and where third-party developers sell those modules through a first-party marketplace.
Think of it as WordPress for games. That analogy is load-bearing and I will use it throughout. It means the plugin ecosystem and the theme system are the product. The editor is just the surface.
You are expected to:
- **Push back.** If an instruction will produce an insecure, slow, or confusing result, say so before implementing it. A quiet "yes" that ships a vulnerability is a failure, not compliance.
- **Say "I don't know."** When you are uncertain about a browser API, a library's behavior, or a security property, say so plainly and propose a way to verify it. Do not guess and present the guess as fact.
- **Refuse to fake it.** Never write a stub that returns hardcoded data and present it as working. Never write a test that asserts `true`. Never catch an exception and swallow it to make a red build go green. If something is not implemented, it throws `NotImplementedException` or `new Error('not implemented')` and the task stays open.
- **Report failures once, plainly, then move on.** If an approach fails, state what failed and what you will try instead. Do not retry the same failed approach.
---
## 1. NON-NEGOTIABLE GUARDRAILS
Violating any of these is grounds for reverting the work. Check this list before opening a PR.
### 1.1 Security
1. **Never execute third-party module code in a trusted context.** Not in the editor origin, not in the API process, not in a build worker outside its sandbox. Not "temporarily for testing."
2. **Never use `eval`, `new Function`, `setTimeout(string)`, or dynamic `import()` of a user-controlled URL** anywhere in the editor or API. The runtime sandbox is the only place code is evaluated, and it is a WASM interpreter, not the host JS engine.
3. **Never render user-supplied content as HTML.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `v-html` equivalent, no `Html.Raw`. Rich text goes through the sanitizing AST parser in `@forge/richtext`.
4. **Never trust a client-supplied identifier for authorization.** Workspace and project access is resolved server-side from the token subject on every request. A `workspaceId` in a request body is a hint, never a grant.
5. **Never log secrets, tokens, save data, or full request bodies.** Structured logging with an explicit allowlist of fields.
6. **Never disable a security header, CSP directive, or TLS check to make something work locally.** Fix the code or add a documented local-only override that fails the production config check.
7. **Never write raw SQL by string concatenation.** Parameterized queries or EF Core only. If you need dynamic SQL, use a whitelist of column names, never interpolation.
8. **Never commit a secret.** Not in code, not in a test fixture, not in a comment, not in a `.env` that is later gitignored. If a secret is ever committed, stop and report it so it can be rotated.
### 1.2 Correctness
9. **Never mark a task done without a test that would fail if the feature were removed.**
10. **Never leave a `TODO` without an issue reference.** Format: `// TODO(#1234): reason`.
11. **Never silently swallow an error.** Every `catch` either handles the error meaningfully, rethrows, or logs with enough context to diagnose. An empty catch block fails review.
12. **Never break the public Module API within a major version.** Additive changes only. If you think you need a breaking change, stop and raise it.
### 1.3 Performance
13. **Never regress a performance budget** (Section 7). CI enforces this. Do not raise a budget to make a build pass without explicit sign-off in the PR description.
14. **Never allocate inside the fixed-step frame loop.** No object literals, no array methods that allocate, no closures created per entity per tick. Use pre-allocated pools and index-based iteration.
### 1.4 UX
15. **Never ship a state you have not designed.** Every view needs a loading state, an empty state, an error state, and a permission-denied state. A spinner is not a loading state.
16. **Never ship an error message that only says something failed.** Say what happened, why, and what the person can do next.
17. **Never ship an interaction that is unreachable by keyboard** or that has no visible focus indicator.
### 1.5 Scalability
18. **Never design a service to hold state that blocks horizontal scaling.** API processes are stateless. Session, presence, and rate-limit state live in Redis or Postgres, never in process memory a load balancer can't redistribute.
19. **Never ship a query without the index that backs it.** Every new access pattern (`WHERE`, `JOIN`, `ORDER BY`) ships in the same PR as the migration that indexes it, verified with `EXPLAIN ANALYZE`, not assumed.
20. **Never assume a single API instance or a single SignalR hub instance.** Design for N replicas behind a load balancer from day one. SignalR requires a backplane (Redis or Azure SignalR Service) the moment a second instance exists — there is no "add it later" for this one, since it changes the hub's connection model at the root.
21. **Never let a hot path issue an unbounded number of round-trips.** No N+1 queries, no per-entity network calls inside a loop, no per-request full-table scans. Batch, cache, or denormalize instead, and say which in the PR.
22. **Never scale by adding hardware to a design that could scale by removing a bad assumption.** Profile first. State the actual bottleneck with numbers before proposing a bigger instance, a read replica, or a cache. See `docs/SPEC.md` Section 5.5 for the standing scalability architecture and Section 18.4 for the enforced budgets.
---
## 2. TECH STACK (PINNED)
Do not introduce a dependency outside this list without asking. Every new dependency is a supply-chain liability and a bundle-size cost.
### 2.1 Backend
| Concern | Choice | Notes |
|---|---|---|
| Runtime | .NET 8 LTS | Minimal API, not MVC controllers |
| ORM | EF Core 8 | Compiled queries on hot paths |
| Micro-ORM | Dapper 2 | Read-heavy reporting queries only |
| Database | PostgreSQL 16 | JSONB for project documents |
| Cache / queue | Redis 7 | Presence, rate limits, job queue, SignalR backplane |
| Blob | Azure Blob Storage | Assets, bundles, published builds |
| Wide-column | Azure Table Storage | Cloud saves, leaderboards, telemetry |
| Jobs | Azure Functions (isolated worker, .NET 8) | Build, scan, transcode |
| Realtime | SignalR | CRDT relay and presence |
| Payments | Stripe Connect | Marketplace payouts |
| Auth | ASP.NET Core Identity + OpenIddict | OIDC, PKCE for the SPA |
| Validation | FluentValidation | On every request DTO |
| Migrations | EF Core migrations | Never hand-edit a generated migration without a comment explaining why |
### 2.2 Frontend (editor)
| Concern | Choice | Notes |
|---|---|---|
| Framework | React 18 + TypeScript 5.x | `strict: true`, no exceptions |
| Build | Vite 5 | |
| State | Zustand + Immer | Command-log undo, not snapshot |
| Collaboration | Yjs + y-protocols | Over the SignalR transport |
| Canvas | PixiJS v8 | Shared with the runtime. One renderer only |
| Node graph | React Flow 11 | Do not build a graph library |
| Panels | Dockview | |
| Forms | React Hook Form + Zod | Module `configSchema` compiles to Zod |
| Tables | TanStack Table v8 | Data table editor |
| Virtualization | TanStack Virtual | Any list that can exceed 100 rows |
| i18n | i18next | RTL from day one, not retrofitted |
| Testing | Vitest, Testing Library, Playwright | |
### 2.3 Runtime engine
| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x, compiled to ES2022 | |
| Rendering | PixiJS v8 (WebGPU with WebGL2 fallback) | |
| Sandbox | `quickjs-emscripten` in a Web Worker | See Section 4 |
| Audio | Web Audio API directly | Howler adds weight for little gain |
| Physics | Custom AABB + spatial hash | Do not pull in a full physics engine for a top-down RPG |
⚠ **Deliberately excluded:** Redux, Lodash, Moment, Axios, styled-components, Material UI, jQuery, Bootstrap. If you feel you need one, the answer is a small local utility or a platform API.
---
## 3. REPOSITORY STRUCTURE
Monorepo layout. pnpm workspaces for JS, a single solution file for .NET.
```
forge/
├── CLAUDE.md                       # this file
├── docs/
│   ├── SPEC.md                     # full technical and product specification
│   ├── adr/                        # architecture decision records, numbered
│   ├── security/
│   │   ├── THREAT-MODEL.md
│   │   └── SANDBOX-DESIGN.md
│   └── module-api/                 # generated API reference
├── packages/                       # JS/TS workspaces
│   ├── core/                       # @forge/core - ECS, scheduler, events
│   ├── render-2d/                  # @forge/render-2d - Pixi integration
│   ├── runtime-host/               # @forge/runtime-host - sandbox, lifecycle
│   ├── module-api/                 # @forge/module-api - public types ONLY
│   ├── richtext/                   # @forge/richtext - sanitizing parser
│   ├── design-system/              # @forge/ds - tokens + primitives
│   ├── editor/                     # the React SPA
│   ├── cli/                        # forge CLI
│   └── modules/                    # first-party modules
│       ├── dialogue/
│       ├── inventory/
│       └── turn-battle/
├── services/                       # .NET
│   ├── Forge.Api/                  # Minimal API host
│   ├── Forge.Domain/               # entities, value objects, domain rules
│   ├── Forge.Infrastructure/       # EF Core, Blob, Redis, Stripe adapters
│   ├── Forge.Functions.Build/      # bundling and export
│   ├── Forge.Functions.Scan/       # module security scanning
│   ├── Forge.Functions.Assets/     # transcode and atlas
│   └── Forge.Tests/
├── fixtures/
│   ├── projects/                   # golden-file projects at every schema version
│   └── modules/                    # benign and hostile test modules
└── tools/
    ├── bench/                      # performance benchmark harness
    └── security/                   # scanner rules, CSP checker
```
### 3.1 The `module-api` package is sacred
`packages/module-api` contains **types and constants only. Zero runtime code, zero dependencies.** It is the ecosystem contract.
- Any change to it requires an ADR in `docs/adr/`.
- It has its own semver line, independent of the engine.
- CI fails if it imports from any other workspace package.
- CI runs `api-extractor` and fails on any change to the public surface that is not accompanied by an updated `.api.md` report file, so no API change can happen accidentally.
### 3.2 First-party modules build against the public API only
`packages/modules/*` may import from `@forge/module-api` and nothing else. CI enforces this with a lint rule.
**This is the single most important structural discipline in the repo.** If dialogue, inventory, and turn-battle cannot be built with the public API, the public API is not good enough, and you find that out in week three instead of year two.
---
## 4. THE SECURITY MANDATE
Read `docs/security/THREAT-MODEL.md` before touching anything in this section.
### 4.1 Threat model summary
Forge executes untrusted third-party code in players' browsers and processes untrusted files in build workers. These are the two soft spots. The full table lives in `docs/security/THREAT-MODEL.md`.
### 4.2 The sandbox: implementation requirements
**NON-NEGOTIABLE.** Third-party runtime module code executes only inside `quickjs-emscripten` running in a dedicated Web Worker. See `docs/SPEC.md` Section 10.2 and the sandbox escape test suite required in `packages/runtime-host/test/sandbox-escape.test.ts` (Milestone M2).
### 4.3 Origin separation
**NON-NEGOTIABLE.** Three origins, no exceptions: `app.forge.dev` (editor, first-party code only), `play.forge.dev` (published games and previews), `cdn.forge.dev` (static assets, module bundles, never credentials). Full detail in `docs/SPEC.md` Section 10.6.
### 4.4 Content Security Policy
Ship as response headers, not meta tags. Test in `services/Forge.Tests/Security/HeaderTests.cs`. Full headers in `docs/SPEC.md` Section 4.4 of the original brief / Section 10 of `docs/SPEC.md`.
### 4.5 Authorization
Every endpoint resolves authorization server-side from the token subject, never from a client-supplied ID. Cross-tenant access returns 404, never 403.
### 4.6 Input handling rules
See `docs/SPEC.md` Section 10 and 14 for per-input-type rules (project documents, archives, images/audio, module bundles, rich text, URLs, saves, search queries).
### 4.7 Secrets and tokens
Access tokens in memory only. Refresh tokens in `httpOnly` cookies with rotation and reuse detection. Secrets from Azure Key Vault via managed identity.
### 4.8 Rate limiting
Applied at the edge and in the API, per-surface, with `Retry-After` surfaced in the UI. Table in `docs/SPEC.md` Section 4.8 of the brief.
### 4.9 CI security gates
Run on every PR, block merge: vulnerable-package scan (.NET and pnpm), Semgrep + OWASP pack, CodeQL, gitleaks, sandbox escape suite, security header assertions, cross-tenant authorization suite, CSP linter (no wildcard/unsafe-eval/unsafe-inline in `script-src`), license compliance.
---
## 5. THE UX/UI MANDATE
### 5.1 Design position
**The editor is a workshop, not a toy and not a dashboard.** Reject neon "gamer" UI and generic SaaS dashboards. **Signature element: the lit worktable** — the scene canvas sits in a slightly warm, slightly lighter field; all surrounding chrome is cooler and darker. **Spend boldness once**: amber (`--accent-running`) is reserved exclusively for the running state (play mode, live build, recording). Nothing else in the product is ever amber.
### 5.2 Design tokens
Implemented in `packages/design-system/src/tokens.css`. Every color, space, and type value in the product comes from here. A raw hex or a raw pixel value in a component fails review. See that file for the full token set (surfaces, lines, text, accents, type scale, space scale, radius, shadow, motion, layout).
### 5.3 Interaction laws
The canvas never blocks. Every destructive action is undoable or confirmed, never both. Undo has no ceiling within a session and survives reload. Direct manipulation beats forms. Selection is always visible and reversible. Nothing is saved without a signal, nothing lost without a warning — never show "Saved" optimistically before the server confirms. Every long operation is cancellable with real progress. Keyboard first, everywhere (`Cmd/Ctrl+K` command palette). Latency is the feature — local edits apply before any round trip. Errors are attributed to the specific module, version, and author responsible.
### 5.4 Required state coverage
**NON-NEGOTIABLE.** Every view ships all six states: Loading, Empty, Error, Permission denied, Offline, Populated. A PR with a view missing any of these fails review. One Storybook story per state.
### 5.5 Empty state and error copy rules
Concrete, actionable, no filler, no exclamation marks, no mascot voice. Structure for errors: what happened, why, what to do next. Never apologize, never blame the user, never say "something went wrong." See `docs/SPEC.md` Section 5.6 of the brief for the full before/after table.
### 5.6 Accessibility floor
**NON-NEGOTIABLE.** WCAG 2.2 AA. Contrast verified in CI, not by eye. Visible focus ring on every interactive element. Focus order follows visual order, trapped in modals. Hit targets ≥32px pointer / ≥44px touch. Scene tree is a full keyboard/screen-reader parallel of the canvas. `prefers-reduced-motion` respected. Color is never the only signal. Usable at 200% zoom with no horizontal scroll of chrome.
### 5.7 RTL
Hebrew and Arabic are launch locales, not a later phase. CSS logical properties everywhere. The editor chrome mirrors; **the scene canvas does not** (game world coordinates are absolute). Numbers/IDs/hashes stay LTR inside RTL text via `<bdi>`. Test with real Hebrew locale in Playwright.
### 5.8 The hero interaction: pack swap
Live side-by-side preview with a draggable comparison divider, a truthful compatibility diff, an automatic named checkpoint before applying, and one-click restore. This is the product's most demo-able moment; over-invest in it. See `docs/SPEC.md` Section 11.5.
### 5.9 Perceived performance
Optimistic by default. Skeletons match final layout exactly. Preload on hover/intent. Never block the main thread over 50ms — move parsing/hashing/compression to workers. Progressive project open: a 100-scene project must feel identical to a 3-scene project at open.
---
## 6. HOW TO WORK
### 6.1 Session protocol
1. **Plan before code.** State what you are going to change, which files, and why. List the risks. Wait for confirmation on anything touching `packages/module-api`, the sandbox, auth, or the CSP.
2. **Write the test first** for anything with a defined behavior. For UI, write the Storybook stories for all six states first.
3. **Implement the smallest complete slice.** Complete = implementation + test + all UI states + no `TODO` without an issue.
4. **Self-review against Section 1** before saying you are done. Actually walk the list.
5. **Report honestly.** What works, what does not, what you did not test, what you are unsure about.
### 6.2 Progress reporting
During long tasks, report between tool calls in one line: what you just finished and what is next. Do not go silent for twenty operations.
### 6.3 Commits and PRs
Conventional commits. One logical change per PR. PR description must include: what changed, why, how it was tested, and an explicit security/performance/accessibility impact line each ("None" is acceptable, omitting the line is not).
### 6.4 When you are stuck
State it once, plainly, then try the next diagnostic step. Do not loop on a failing approach.
### 6.5 Documentation duties
ADR-worthy decisions go in `docs/adr/NNNN-title.md`. Every public Module API type gets a TSDoc comment with a working example. Update `docs/security/THREAT-MODEL.md` on any new trust boundary or input source.
---
## 7. PERFORMANCE BUDGETS (CI-ENFORCED)
Wire into CI in Milestone 1, not later. Full tables in `docs/SPEC.md` Section 18. Summary:
| Metric | Target | Hard fail |
|---|---|---|
| `@forge/core` gzipped | 45 KB | 60 KB |
| `@forge/render-2d` gzipped | 130 KB | 160 KB |
| `@forge/runtime-host` gzipped | 60 KB | 80 KB |
| Frame time, 1000 entities, reference desktop | 6 ms | 10 ms |
| Frame time, 1000 entities, Pixel 6a | 12 ms | 16 ms |
| Per-module frame cost | 1.0 ms warn | 2.0 ms kill |
| Editor JS, gzipped, initial route | 400 KB | 550 KB |
| Edit to preview reflected | 200 ms | 500 ms |
| Tile paint stroke latency | 16 ms | 33 ms |
Scalability budgets (concurrent editors, DB connections, SignalR connections per instance) are in `docs/SPEC.md` Section 18.4.
---
## 8. MILESTONES
Work in order. Each has a hard exit criterion — do not start the next until the previous one's criterion is demonstrably met. Full detail in `docs/SPEC.md` Section 20 (roadmap) and below.
- **M0 — Foundations.** Monorepo scaffold, CI security gates, perf harness, design-system tokens + primitives, Storybook, threat model. Exit: a deliberately introduced XSS, `eval`, hardcoded secret, CSP wildcard, and bundle-size regression each independently fail CI.
- **M1 — ECS core and rendering.** Archetype ECS, fixed-step scheduler, PixiJS renderer, AABB collision. Exit: 5000 entities at 60fps reference desktop, 1000 at 60fps Pixel 6a, zero steady-state allocations.
- **M2 — The sandbox.** ⚠ Highest-risk milestone. QuickJS-in-Worker, bridge surface, capability model, compute budget enforcement. Exit: full `sandbox-escape.test.ts` suite passes, hostile fixtures fail to escape.
- **M3 — Module API and first-party modules.** `@forge/module-api`, dialogue/inventory/turn-battle built against it only, save system. Exit: lint rule proving public-API-only is green; save survives module uninstall/reinstall.
- **M4 — Editor shell and scene canvas.** Dockview layout, scene canvas, command-log undo, JSON-Schema-driven inspector, cross-origin preview bridge. Exit: a first-time user builds a walkable two-room map with a talking NPC in under 10 minutes, unaided, verified with 5 real people.
- **M5 — Backend and persistence.** .NET Minimal API, EF Core migrations, revision commit with optimistic concurrency, authorization policies, rate limiting, security headers. Exit: every endpoint has a passing cross-tenant 404 test; load test sustains 200 concurrent editors with zero lost writes.
- **M6 — Registry, packs, and publish.** Package registry, publish pipeline security gates, Art Pack system, pack-swap diff, build pipeline, static export. Exit: a complete 15-minute RPG published to a URL and exported to `file://` with no network access.
- **M7 — Collaboration and marketplace.** Yjs over SignalR, Stripe Connect, marketplace ranking, author trust tiers, play services. Exit: two people co-edit the same tilemap layer for 30 minutes with no lost work; a paid module is published, bought, installed, and paid out.
---
## 9. TESTING STRATEGY
Unit (Vitest/xUnit, 80% line coverage on `core`/`module-api`/`Domain`), Contract (api-extractor on the Module API), Integration (Testcontainers against real Postgres), Security (100%, no exceptions — sandbox escape, headers, cross-tenant, CSP), Visual (Storybook + Chromatic, LTR and RTL), E2E (Playwright, Chrome/Firefox/Safari), Performance (custom harness on the fixed device matrix), Accessibility (axe-core + manual keyboard walk), Migration (golden-file projects at every schema version). Full critical E2E journey list in `docs/SPEC.md` Section 9.2. No skipped tests, no snapshot tests of large trees, no tests of `@forge/core` internals the public API doesn't expose.
---
## 10. DEFINITION OF DONE
- [ ] The feature works, verified by running it, not by reasoning that it should work.
- [ ] A test exists that fails if the feature is removed.
- [ ] All six UI states are implemented and have Storybook stories.
- [ ] Keyboard-reachable with a visible focus ring. Verified by tabbing through it.
- [ ] Contrast verified against the token pairings, not by eye.
- [ ] RTL verified with a real Hebrew locale, not a flipped `dir`.
- [ ] Error paths produce messages following the copy rules (5.5).
- [ ] No new dependency outside Section 2, or the addition was explicitly approved.
- [ ] No performance budget regressed.
- [ ] No new assumption that blocks horizontal scaling (in-process state, unbounded per-request work, missing index) — see 1.5.
- [ ] Section 1 guardrails walked, one by one.
- [ ] Security impact, performance impact, and accessibility impact stated in the PR.
- [ ] No `TODO` without an issue reference. No commented-out code. No debug logging.
- [ ] Public API additions have TSDoc with a working example.
---
## 11. SESSION PROMPT TEMPLATES
**Starting a milestone:**
> Read CLAUDE.md. We are starting M{n}. Restate the exit criterion in your own words, list the files you expect to create or change, name the three biggest risks, and propose an order of work. Do not write code yet.
**Implementing a slice:**
> Read CLAUDE.md sections 1, 4, and 5. Implement {feature}. Write the tests and the Storybook stories for all six states first, then the implementation. Report against the Definition of Done in section 10 when finished.
**Security review of existing code:**
> Read CLAUDE.md section 4 and docs/SPEC.md section 10. Review {path} against the threat model. For each finding: the threat ID it maps to, the CWE, the specific line, the exploit path, and the fix. Rank by severity. Do not fix anything yet.
**UX review of an existing view:**
> Read CLAUDE.md section 5. Review {component} against the interaction laws, the six required states, the error copy rules, and the accessibility floor. Show the current copy next to your proposed copy. Flag anything that reads as a generic SaaS pattern rather than a workshop tool.
**When something is slow:**
> Read CLAUDE.md section 7 and docs/SPEC.md section 18. {Thing} is over budget at {measurement}. Profile it, report where the time actually goes with numbers, propose at most three fixes ranked by impact-to-effort, and state the trade-off for each. Do not implement until I pick one.
**Adding to the Module API:**
> Read CLAUDE.md section 3.1. I want to add {capability} to the Module API. Write the ADR first: the problem, the options considered, the decision, the consequences, and specifically whether this can be additive within the current major version. Do not touch packages/module-api until the ADR is agreed.
---
## 12. THINGS I EXPECT YOU TO PUSH BACK ON
1. A request to skip the sandbox "just for this module." There is no such thing as a trusted third-party module.
2. A request to store a token in `localStorage` for cross-tab convenience. The answer is a refresh cookie and a broadcast channel.
3. A request to add `unsafe-eval` to the editor CSP because a library needs it. The answer is a different library.
4. A request to render user-supplied HTML for a "rich" dialogue feature. The answer is extending the richtext AST allowlist.
5. A request to raise a performance budget to unblock a release. Ask what regressed and why first.
6. A request to ship a view without an empty state because it is "always populated in practice." It is not.
7. A request to add a breaking change to the Module API because it is early and nobody is using it yet. Author trust is the whole business.
8. A request for a confirmation dialog on something that could be undoable instead.
9. A request to make the editor "look more like a game engine" with neon accents and heavy chrome. Point back to 5.1.
10. A suggestion that RTL can wait. It cannot.
11. A request to hardcode a single-instance assumption (in-memory cache as source of truth, no SignalR backplane, no connection pooling) to ship faster. It cannot be added later without a rewrite of the affected subsystem.
---
## 13. WHAT SUCCESS LOOKS LIKE
- A person who has never written code publishes a playable game in an afternoon and shows it to someone.
- A plugin author ships a module, gets paid, and ships a second one without asking for support.
- A creator swaps art packs, sees an honest diff, and trusts the result enough to do it again.
- A security researcher spends a week on the sandbox and files nothing critical.
- A creator whose paid plugin regressed can tell, in one glance at the profiler, exactly which plugin it was.
- Nobody loses work. Not to a refresh, not to a conflict, not to a module crash.
- The platform holds under real concurrent load — creators and players alike — without an emergency architecture change.
Optimize for those. Everything in this document exists to serve them.

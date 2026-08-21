# Forge Threat Model

Status: living document. Update whenever a new trust boundary or input source is added (CLAUDE.md Section 6.5).

## 1. Trust boundaries

Forge executes untrusted third-party code in players' browsers and processes untrusted files in build workers. These are the two soft spots in the system, and every other boundary below exists to contain them.

```
┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
│   app.forge.dev      │        │   play.forge.dev     │        │   cdn.forge.dev      │
│   Editor SPA          │◄─────►│   Published games,    │◄──────│   Static assets,      │
│   First-party code     │ CSP + │   game previews        │  read │   module bundles      │
│   only. No user        │postMsg│   Module sandbox lives  │ only  │   Never credentials   │
│   content ever served. │       │   here (Worker+WASM)    │       │                       │
└─────────────────────┘        └─────────────────────┘        └─────────────────────┘
          │                              │
          │ HTTPS/WSS, OIDC bearer       │ HTTPS, no editor session
          ▼                              ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           API (.NET 10, api.forge.dev)                    │
│   Every request re-derives authorization from the token subject.         │
│   Never trusts a client-supplied workspaceId/projectId as a grant.       │
└───────────────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────────┐        ┌─────────────────────────────────────────┐
│  PostgreSQL / Redis   │        │  Azure Functions (build/scan/assets)     │
│  Trusted data plane   │        │  Process UNTRUSTED module + asset bytes │
│                       │        │  Zero network egress except Blob        │
│                       │        │  Fresh container per job, hard caps     │
└─────────────────────┘        └─────────────────────────────────────────┘
```

## 2. Threat table

| ID | Threat | CWE | Severity | Primary control |
|---|---|---|---|---|
| T1 | Malicious module exfiltrates player save data | CWE-200 | High | Capability model, CSP `connect-src` allowlist |
| T2 | Malicious module escapes the sandbox into the game origin | CWE-693 | Critical | QuickJS-WASM interpreter, no host realm references |
| T3 | Malicious module escapes into the **editor** origin | CWE-79 | Critical | Origin separation, declarative editor UI |
| T4 | Supply chain: compromised author account publishes a bad version | CWE-506 | Critical | Mandatory 2FA, scoped tokens, 24h propagation delay |
| T5 | Module consumes unbounded CPU or memory | CWE-400 | High | QuickJS interrupt handler, WASM memory cap |
| T6 | Crafted asset exploits an image or audio decoder | CWE-787 | High | Isolated worker (`Forge.Functions.Assets`, a process distinct from `Forge.Api`), decode via a fully-managed (no native/unmanaged code) image library, re-encode never pass-through, declared-dimension cap checked before full decode, resource caps — see `docs/adr/0012` |
| T7 | Stored XSS via dialogue text, item names, project descriptions | CWE-79 | High | Text nodes only, sanitizing AST for rich text |
| T8 | IDOR on project, asset, or build endpoints | CWE-639 | High | Server-side authorization on every request, no client-supplied scope |
| T9 | SSRF via module manifest URLs or asset import-by-URL | CWE-918 | High | No server-side fetch of user URLs. Ever |
| T10 | Zip-slip / path traversal on project import | CWE-22 | High | Path canonicalization and allowlist on every archive entry |
| T11 | Billing manipulation via tampered checkout or a forged client-supplied plan/tier | CWE-602 | High | Server-side price resolution, Stripe webhook signature verification, plan resolved from `subscriptions`/`workspaces` server-side on every request (`docs/SPEC.md` Section 23.5) — never accepted from the client |
| T12 | Save data deserialization attack | CWE-502 | Medium | JSON only, schema-validated, no type hints, no polymorphic deserialization |
| T13 | Denial of service via oversized project documents or saves | CWE-770 | Medium | Hard size caps at the edge, before parsing |
| T14 | Session hijacking via token in URL or localStorage | CWE-522 | High | Tokens in memory + httpOnly refresh cookie, never localStorage |
| T15 | Creator ships a game that phishes players | CWE-451 | Medium | Persistent platform chrome on hosted games, no fullscreen overlay of platform UI |
| T16 | Architecture cannot scale horizontally (stateful SignalR hub, in-memory rate limiter, unpooled DB connections), leading to an outage rather than a compromise under real load | CWE-770 (resource exhaustion) | High | Stateless API, Redis-backed rate limiter and SignalR backplane, pooled DB connections — see `docs/SPEC.md` Section 5.5 and Section 1.5 of `CLAUDE.md` |
| T17 | Signup/login abuse: credential stuffing, account enumeration via signup error messages, brute-forcing an email-verification or password-reset token | CWE-307 / CWE-203 | High | Rate limiting on `/auth/*` (CLAUDE.md Section 4.8), generic "check your email" response regardless of whether the address exists, single-use time-boxed tokens via Identity's data-protection provider — see `docs/SPEC.md` Section 23.3 |
| T18 | Creator's free-text art-generation prompt manipulates the expansion step, or a generated image is a hostile/malformed byte stream | CWE-1427 (prompt injection) / CWE-787 (via T6's existing control) | Medium | System-instruction/user-content separation in the Gemini expansion call, bounded blast radius (no downstream code ever executes or interprets either model's output as instructions), generated images routed through the same untrusted-decode pipeline T6 already uses, unmodified — see `docs/adr/0016` |

## 3. Detailed notes per threat class

### 3.1 Runtime module sandbox (T1, T2, T5)
Third-party runtime module code executes only inside `quickjs-emscripten` in a dedicated Web Worker. See `docs/SPEC.md` Section 10.2 for the ranked sandbox options and the recommendation, and `docs/security/SANDBOX-DESIGN.md` for the adversarial write-up, including what's empirically verified versus still assumed. Required test suite: `packages/runtime-host/test/sandbox-escape.test.ts` (CLAUDE.md Section 4.2 / `docs/SPEC.md` Section 10) — not yet written; the fixture checklist SANDBOX-DESIGN.md Section 7 defines is what it must cover.

### 3.2 Origin separation (T3, T14, T15)
Three origins, no exceptions: `app.forge.dev` (editor, first-party only), `play.forge.dev` (published games, previews), `cdn.forge.dev` (static assets, never credentials). Editor embeds the preview in a cross-origin `<iframe>`; every inbound `postMessage` is origin-checked and Zod-schema-validated before use.

### 3.3 Supply chain (T4)
Mandatory 2FA on any publishing account, scoped per-package publish tokens, OIDC trusted publishing from CI, a publish notification to every installer, and a 24-hour default propagation delay for packages above 1,000 installs. See `docs/SPEC.md` Section 10.5.

### 3.4 Input handling (T6, T7, T9, T10, T12, T13)
Every input source has a specific rule (project documents, uploaded archives, images/audio, module bundles, rich text, URLs, saves, search queries). See `docs/SPEC.md` Section 14 and the input handling table referenced from CLAUDE.md Section 4.6. The unifying rule: **the server never fetches a user-supplied URL**, and **nothing user-supplied is ever rendered or deserialized as anything other than data**.

### 3.5 Authorization (T8)
Every endpoint resolves the caller's role server-side from the token subject via `WorkspaceAuthorizationHandler`, never from a client-supplied ID. Cross-tenant access returns **404**, never 403 — a 403 confirms the resource exists and leaks the ID space. Full authorization test suite required per endpoint (CLAUDE.md Section 4.5).

### 3.6 Billing (T11)
Price resolution happens server-side from the package's `listings` row, never from a client-supplied amount. Stripe webhook signatures are verified before any purchase or license is recorded. The same rule now covers platform subscription gating (`docs/SPEC.md` Section 23.5): a workspace's plan is read from the `subscriptions` table, itself written only by verified Stripe webhook events, never from anything the checkout-session response handed to the browser.

### 3.7 Availability under load (T16)
Distinct from the other threats in that the attacker may simply be organic growth. Stateless API tier, Redis-backed rate limiting and SignalR backplane, pooled DB connections with read-replica routing for reporting queries, and CDN/Table-Storage-carried play traffic are the controls. See `docs/SPEC.md` Section 5.5 (architecture) and Section 18.4 (enforced budgets).

### 3.8 Account signup and login surface (T17)
`/api/v1/auth/signup`, `/connect/token`, `/api/v1/auth/password/forgot`, and `/api/v1/auth/resend-verification` are the only unauthenticated endpoints in the API and the newest trust boundary in the system — anyone on the internet can call them, not just an existing token holder. Rate limiting applies per-IP and per-account-identifier (CLAUDE.md Section 4.8), signup/forgot-password responses never reveal whether an email address is already registered, and verification/reset tokens are single-use and short-lived (Section 23.3). This boundary did not exist before Section 23 and is recorded here per the living-document rule at the top of this file.

### 3.9 Untrusted asset pipeline (T6)
`docs/adr/0012` is the concrete architecture: `Forge.Api` accepts uploaded bytes (base64, size-capped, quota-checked against `workspaces.storage_quota_mb`) and moves them, undecoded, to a private `assets-quarantine` blob container — it never opens them as an image. `Forge.Functions.Assets` (a distinct process, zero network egress, fresh invocation per job) does the only decode: a header-only dimension pre-check before any full decode, then a full decode/re-encode using SixLabors.ImageSharp, a fully-managed .NET image library with no native/unmanaged code in its decode path — the deliberate answer to CWE-787 for this specific threat, since a managed runtime cannot have an out-of-bounds *write* the way a native codec can. The bytes a player's browser ever receives are the re-encoded output ImageSharp produced from decoded pixel data, uploaded to a **separate public** blob container — never the originally-uploaded bytes, and never served with the client's declared (attacker-controlled) MIME type. `image/svg+xml` is rejected outright at upload, not processed as a raster format: SVG is inline-executable markup and accepting it as an image would reopen T7's CWE-79 hole through a different input path. v1 covers images only (PNG/JPEG/WebP) — audio and font processing are named, deferred future work, not silently out of scope.

### 3.10 AI-assisted art generation (T18)
`docs/adr/0016` is the concrete architecture. A creator's free-text description is expanded into a real generation prompt by a server-side Gemini text call (`Forge.Api`, synchronous — the API key lives in `ArtGeneration:GeminiApiKey` configuration, never returned to or accepted from the client), then an async image-generation call (`Forge.Functions.ArtGen`, matching the existing claim/orchestrate worker shape) produces variations. The system instruction fixing Forge's own generation conventions is kept separate from the creator's text (the Gemini API's own system-instruction/user-content split), not string-concatenated — the actual prompt-injection defense, and, as of the N7 review below, verified against the real outgoing request body rather than trusted from this prose. Nothing downstream ever executes or interprets either model's text output as an instruction to a privileged system; the worst realistic outcome of a manipulated prompt is a wrong or provider-declined image, scoped to the requesting creator's own pack. The generated image bytes themselves get zero special trust: they enter the *identical* T6 pipeline (3.9) a creator-uploaded image would — quarantine, dimension pre-check, managed decode/re-encode — before any category-specific processing (a C#/ImageSharp port of this session's `chroma_key_extract.py` spill-score algorithm) runs on the already-verified pixels. Generation is gated behind a paid plan (`PlanGateRequirement`, the same wall `docs/SPEC.md` Section 23.5 already puts on export/publish) plus a request-rate limit and a live per-workspace-per-day budget check (not a cached counter, tiered by plan as of N6) — two independent controls on the real per-call external cost, not one.

**N7 review finding, fixed in the same pass (CWE-532, insertion of sensitive information into a log file):** `GeminiArtGenerationClient` originally sent the Gemini API key as a `?key=` URL query parameter. ASP.NET Core's `HttpClientFactory` attaches request-logging handlers by default to every typed client — including this one, `Forge.Api`'s first `HttpClient` consumer — that log the full `RequestUri` (query string included) at `LogLevel.Information`, and `Forge.Api`'s own `appsettings.json` runs at that default level. That combination meant the key would land in application logs on every real call this client makes, a direct violation of CLAUDE.md Section 1.1 guardrail 5. Fixed by moving the key to the `x-goog-api-key` request header (the default logging handlers do not log headers), verified with a real captured-request test (`GeminiArtGenerationClientTests.cs`) asserting the key never appears in the request URI and does appear on the header — a root-cause fix, not a mitigation that depends on log-level discipline someone could later loosen. This was the only exploitable finding N7 turned up; the prompt-injection defense (system-instruction/user-content separation) and the T6 image-decode reuse were both verified as already correctly implemented, not just designed.

## 4. CI security gates enforcing this model

Per CLAUDE.md Section 4.9 / `docs/SPEC.md` Section 10.4: vulnerable-dependency scans (.NET and pnpm), Semgrep + OWASP Top 10 ruleset, CodeQL, gitleaks secret scanning, the sandbox escape suite, security header assertions, the cross-tenant authorization suite, a CSP linter rejecting any wildcard/`unsafe-eval`/`unsafe-inline` in `script-src`, and license compliance checks. These gates are scaffolded in Phase 3 of M0 and must independently fail CI on a deliberately introduced violation before M0 is considered exited.

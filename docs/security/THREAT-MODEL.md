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
│                           API (.NET 8, api.forge.dev)                     │
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
| T6 | Crafted asset exploits an image or audio decoder | CWE-787 | High | Isolated worker, re-encode never pass-through, resource caps |
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

## 3. Detailed notes per threat class

### 3.1 Runtime module sandbox (T1, T2, T5)
Third-party runtime module code executes only inside `quickjs-emscripten` in a dedicated Web Worker. See `docs/SPEC.md` Section 10.2 for the ranked sandbox options and the recommendation, and `docs/security/SANDBOX-DESIGN.md` (written during M2) for the adversarial write-up. Required test suite: `packages/runtime-host/test/sandbox-escape.test.ts` (CLAUDE.md Section 4.2 / `docs/SPEC.md` Section 10).

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

## 4. CI security gates enforcing this model

Per CLAUDE.md Section 4.9 / `docs/SPEC.md` Section 10.4: vulnerable-dependency scans (.NET and pnpm), Semgrep + OWASP Top 10 ruleset, CodeQL, gitleaks secret scanning, the sandbox escape suite, security header assertions, the cross-tenant authorization suite, a CSP linter rejecting any wildcard/`unsafe-eval`/`unsafe-inline` in `script-src`, and license compliance checks. These gates are scaffolded in Phase 3 of M0 and must independently fail CI on a deliberately introduced violation before M0 is considered exited.

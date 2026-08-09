# 3. Creator accounts: own identity + federation, domain table separate from Identity's schema

Date: 2026-08-05

## Status

Accepted

## Context

`docs/SPEC.md` Section 22 Open Question 3 left "own the identity system or federate?" unresolved, and until now there was no platform-level account/subscription system at all — Section 16's Stripe Connect integration pays module *authors*, it doesn't charge *creators* for platform access. The `workspaces.plan` column (`free | pro | studio`) has existed in the schema since M0 planning, but nothing ever defined what those tiers gate or how an account gets created in the first place.

Two decisions were needed before Section 23 could be written:

1. **Own the identity system, or federate to Google/Discord?** Pure federation reduces signup friction but complicates account recovery and, per the original open question, "complicates payouts" — an author's payout identity and their login method shouldn't be the same thing, or losing access to a Discord account could mean losing access to real money.
2. **Does the domain `users` table (Section 6.2) share a schema with ASP.NET Core Identity, or reference it?** Identity's own tables (`AspNetUsers`, `AspNetUserTokens`, etc.) carry password hashes, security stamps, and other auth-mechanism-specific columns that have no business appearing in a domain model joined against `workspaces`, `projects`, and `purchases`.

## Decision

- **Both, local-first.** Email + password via ASP.NET Core Identity is the canonical account. Google and Discord OAuth are *additional* login methods matched onto the same account by verified email — not a replacement for it. Author payouts and account recovery always key off the verified email, regardless of which login method was used that session.
- **The domain `users` table is a projection, not Identity's internal store.** It's linked via `identity_subject_id` (the OpenIddict token's `sub` claim), keeping Identity's mechanism-specific columns out of a table that `workspace_members`, `purchases`, and now `subscriptions` all join against.
- **Free is a real permanent tier, not a trial.** The alternative (a time-boxed trial) was rejected because it fights CLAUDE.md Section 5.3's "the canvas never blocks" interaction law with countdown-anxiety UX, and because gating at *export/publish* rather than at *usage* is what makes Free tier cost near-zero regardless of how long someone stays on it (Section 23.2) — the wizard-generation cap and the export/publish gate are the only two costed levers, and both are already accounted for in the bootstrap-phase cost estimate in `docs/proposals/0001`.
- **Stripe is the system of record for plan state; the `subscriptions` table is a read model.** It is written only by signature-verified webhook events, never by the checkout-session response the browser sees — the same discipline Section 10 threat T11 already required for marketplace billing, now extended to platform subscriptions (Section 23.5).

Full design: `docs/SPEC.md` Section 23. Schema: `users.identity_subject_id`/`email_verified_at`/`stripe_customer_id` and the new `subscriptions` table, Section 6.2. Threat model: T17 (signup/login abuse) and T11's extended scope, `docs/security/THREAT-MODEL.md`.

## Consequences

- Milestone placement: M5 (Backend and persistence), alongside the authorization-policy work already scoped there — not a new milestone, since it needs the same server-side auth foundation and doesn't block M1–M4's engine/editor work.
- The Free-tier gate table in Section 23.2 is a proposed default, explicitly flagged as easy to re-cut once real users hit it — this ADR does not lock in the exact numbers (5 wizard generations/month, 1 project, etc.), only the *shape* of the gate (editor access always full; export/publish is the wall).
- `stripe_account` (author payouts) and `stripe_customer_id` (subscription billing) are deliberately separate columns on `users`, even though both are "a Stripe ID on the user row" — collapsing them would make it possible for a payout webhook and a subscription webhook to be misattributed to the wrong flow.
- No change to the Module API, the sandbox, or any already-shipped M0–M1 code. This ADR only extends the not-yet-built backend surface.

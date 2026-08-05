# 1. Record architecture decisions

Date: 2026-08-05

## Status

Accepted

## Context

Forge is a large, long-lived platform (CLAUDE.md, `docs/SPEC.md`). Decisions about the Module API, the sandbox, origin separation, and the data model need a durable record of *why*, not just *what*, so a future session (human or Claude) does not silently re-litigate or accidentally violate a decision already made for a reason.

We need to record architecture decisions made in this project.

## Decision

We will use Architecture Decision Records (ADRs) as described by Michael Nygard, one file per decision, numbered sequentially, in `docs/adr/`.

Each ADR uses this template:

```markdown
# N. Title

Date: YYYY-MM-DD

## Status

Proposed | Accepted | Superseded by ADR-000N

## Context

What forces are at play, technical and non-technical, and what is the problem being solved.

## Decision

What we decided to do.

## Consequences

What becomes easier or harder as a result of this decision. Include trade-offs honestly — an ADR that only lists benefits is not trustworthy.
```

Per CLAUDE.md Section 3.1 and Section 6.5: any change to `packages/module-api`'s public surface, any change to the sandbox bridge surface (`packages/runtime-host/src/bridge/surface.ts`), and any decision judged "ADR-worthy" during a session, gets a numbered ADR here before the change lands.

## Consequences

- Decisions are discoverable without archaeology through git blame or scrollback.
- Every session that touches a sensitive area (Module API, sandbox, CSP) has a checklist item: read the relevant ADRs first.
- Adds a small amount of process overhead to genuinely architectural changes. This is deliberate friction — see CLAUDE.md Section 12, item 7: an unstable Module API is the one mistake that cannot be undone once authors depend on it.

---

# Foundational decisions recorded at M0 scaffold time

The following decisions were made while scaffolding the repository (Phase 1 of M0) and are recorded here rather than as separate ADRs because they are structural defaults from CLAUDE.md itself, not new judgment calls — they are listed so the reasoning is attached to the commit that first encodes them in the repo layout.

1. **Monorepo, pnpm workspaces for JS/TS, one .NET solution for C#.** Rationale: `packages/module-api` must be independently versioned and dependency-isolated from every other JS package (CLAUDE.md 3.1), which pnpm workspaces support natively via strict node-linker behavior; the .NET services share a data layer and deploy together, so one solution file is simpler to reason about than a second monorepo tool.
2. **`docs/SPEC.md` holds the full technical/product specification; `CLAUDE.md` holds the operating contract and points into it.** Rationale: CLAUDE.md is read in full at the start of every session and must stay a governable size; the detailed schemas, endpoint surfaces, and worked code samples belong in a reference document that is consulted, not re-read cover to cover every time.
3. **Scalability is a Section 1 guardrail (1.5) and an explicit architecture section (`docs/SPEC.md` 5.5), not deferred to a later milestone.** Rationale (per explicit product direction): a stateful SignalR hub, an in-memory-only rate limiter, or an unpooled DB connection story cannot be retrofitted onto a shipped collaboration feature without a hub redesign — see `docs/SPEC.md` Section 5.5 for the specific mechanisms (backplane, pooling, read replicas, partition-keyed Table Storage) and Section 18.4 for the budgets that make this enforceable rather than aspirational.

# Forge

Forge is a browser-based platform where non-programmers assemble publishable 2D top-down RPGs from swappable art packs and drag-in behavior modules, and where third-party developers sell those modules through a first-party marketplace. Think WordPress, but for games.

## Start here

- **[`CLAUDE.md`](./CLAUDE.md)** — the standing operating contract for this repository: guardrails, tech stack, milestone plan, and definition of done. Read it before writing any code.
- **[`docs/SPEC.md`](./docs/SPEC.md)** — the full technical and product specification: domain model, system architecture, data model, Module API, security model, Art Pack system, and roadmap.
- **[`docs/security/THREAT-MODEL.md`](./docs/security/THREAT-MODEL.md)** — the threat model and trust boundaries.
- **[`docs/adr/`](./docs/adr/)** — architecture decision records.

## Repository layout

```
forge/
├── packages/        # JS/TS workspaces (pnpm) — engine, editor, first-party modules
├── services/         # .NET solution — API, domain, infrastructure, build/scan/asset Functions
├── docs/             # specification, ADRs, security docs
├── fixtures/         # golden-file projects and benign/hostile test modules
└── tools/            # performance benchmark harness, security tooling
```

## Status

Milestone M0 (Foundations) is in progress. See `CLAUDE.md` Section 8 for the full milestone plan and exit criteria. Nothing in `packages/` or `services/` beyond scaffolding is implemented yet — every package/project stub throws `not implemented` rather than faking behavior, per `CLAUDE.md` Section 0.

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 10 (`corepack enable` or install per `packageManager` in `package.json`)
- .NET 8 SDK (not yet verified installable in every environment this repo has been scaffolded in — see commit history for notes)

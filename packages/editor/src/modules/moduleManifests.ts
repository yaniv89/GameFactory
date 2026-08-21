import type { ObjectSchema } from "../inspector/jsonSchema";

export interface ModuleManifest {
  readonly name: string;
  readonly summary: string;
  /** Absent when the module has no flat, form-editable config (e.g. dialogue's `trees` is a nested tree structure — CLAUDE.md 5.9's future dialogue tree editor, not this panel). */
  readonly configSchema?: ObjectSchema;
}

/**
 * The three modules built in M3 (packages/modules/dialogue|inventory|turn-battle)
 * — bundle-time-known fact, not placeholder data, same reasoning as
 * DockviewPanels.tsx's prior FIRST_PARTY_MODULES list. The registry (M6)
 * replaces this with a real marketplace catalog; until then, this first-
 * party trio is the entire catalog there is to install from.
 *
 * `configSchema` here mirrors what each module's `SetupContext.config`
 * actually reads (see each module's `src/types.ts` "ModuleConfig"
 * interface and its `ctx.config` read in `src/index.ts`)
 * — not a fictional example. There's no build pipeline yet to carry this
 * config into a published game (M6), so installing and configuring a
 * module here is real, undoable project state that has no runtime
 * consumer yet, the same honestly-scoped gap as Phase 2's SceneCanvas
 * painting tiles nothing exports.
 */
export const FIRST_PARTY_MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    name: "@forge/dialogue",
    summary: "Dialogue trees with translatable, filterable lines.",
  },
  {
    name: "@forge/graph-runtime",
    // No configSchema — same reason dialogue has none: its real config
    // (docs/adr/0017, M5) is every authored graph in the project (see
    // GraphsPanel), not a flat form.
    summary: "Interprets node graphs authored in the graph editor.",
  },
  {
    name: "@forge/inventory",
    summary: "Per-entity item stacks, capacity limits, and a shop flow.",
    configSchema: {
      type: "object",
      properties: {
        defaultMaxSlots: {
          type: "integer",
          title: "Default inventory slots",
          minimum: 1,
          maximum: 200,
          default: 20,
        },
      },
      required: ["defaultMaxSlots"],
    },
  },
  {
    name: "@forge/turn-battle",
    summary: "1v1 turn-based combat with hit chance and damage filters.",
    configSchema: {
      type: "object",
      properties: {
        baseHitChance: {
          type: "number",
          title: "Base hit chance",
          minimum: 0,
          maximum: 1,
          default: 0.9,
        },
      },
      required: ["baseHitChance"],
    },
  },
];

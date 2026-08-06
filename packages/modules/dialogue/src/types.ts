import type { DialogueChoice, EntityId } from "@forge/module-api";

export interface DialogueChoiceConfig {
  readonly id: string;
  readonly text: string;
  /** Index into the tree's `nodes` array to jump to. -1 ends the dialogue. */
  readonly next: number;
}

export interface DialogueNodeConfig {
  readonly speaker: string;
  readonly text: string;
  readonly locale?: string;
  /** Omit or leave empty to end the dialogue after this line. */
  readonly choices?: readonly DialogueChoiceConfig[];
  /** Seconds before auto-advancing to `choices[0]` (or ending, if there are no choices). Omit to require an explicit "dialogue:choose"/"dialogue:advance" event. */
  readonly autoAdvanceSec?: number;
}

export interface DialogueTreeConfig {
  readonly id: string;
  readonly nodes: readonly DialogueNodeConfig[];
}

/** Shape of `SetupContext.config` this module expects (docs/SPEC.md Section 9.2's `configSchema`, validated at install time by the registry — out of scope for this module itself). */
export interface DialogueModuleConfig {
  readonly trees?: readonly DialogueTreeConfig[];
}

export interface StartDialogueEvent {
  readonly entity: EntityId;
  readonly treeId: string;
}
export interface ChooseDialogueEvent {
  readonly entity: EntityId;
  readonly choiceId: string;
}
export interface DialogueShownEvent {
  readonly entity: EntityId;
  readonly speaker: string;
  readonly text: string;
  readonly locale: string;
}
export interface DialogueChoicesShownEvent {
  readonly entity: EntityId;
  readonly choices: readonly DialogueChoice[];
}
export interface DialogueEndedEvent {
  readonly entity: EntityId;
  readonly treeId: string;
}
export interface DialogueAutoAdvanceElapsedEvent {
  readonly entity: EntityId;
  readonly treeId: string;
}

/** The `DialogueState` component's field shape — component fields are number/boolean only (docs/SPEC.md Section 4.2), so `tree`/`node` are indices into config.trees rather than string ids. */
export interface DialogueStateShape extends Record<string, number | boolean> {
  active: boolean;
  tree: number;
  node: number;
  /** Seconds remaining before auto-advance fires. -1 means disabled. */
  autoAdvanceSec: number;
}

export const NO_AUTO_ADVANCE = -1;
export const DIALOGUE_STATE_COMPONENT = "DialogueState";

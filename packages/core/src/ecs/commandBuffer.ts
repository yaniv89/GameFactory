import type { EntityId } from "./entity";

export type ComponentFieldValues = Readonly<Record<string, number>>;

export interface CreateCommand {
  readonly kind: "create";
  readonly entity: EntityId;
  readonly components: ReadonlyMap<number, ComponentFieldValues>;
}
export interface DestroyCommand {
  readonly kind: "destroy";
  readonly entity: EntityId;
}
export interface AddCommand {
  readonly kind: "add";
  readonly entity: EntityId;
  readonly componentId: number;
  readonly value: ComponentFieldValues;
}
export interface RemoveCommand {
  readonly kind: "remove";
  readonly entity: EntityId;
  readonly componentId: number;
}

export type Command = CreateCommand | DestroyCommand | AddCommand | RemoveCommand;

/**
 * Structural changes (create, destroy, add, remove — anything that moves an
 * entity between archetypes) are deferred here and applied by
 * World.flush() at a phase boundary, per docs/SPEC.md Section 8.4: doing it
 * immediately mid-query would invalidate the archetype the caller is
 * currently iterating. `World.set()` (writing existing field values) is
 * NOT deferred — it never changes archetype membership, so it's safe to
 * apply immediately.
 */
export class CommandBuffer {
  private commands: Command[] = [];

  create(entity: EntityId, components: ReadonlyMap<number, ComponentFieldValues>): void {
    this.commands.push({ kind: "create", entity, components });
  }

  destroy(entity: EntityId): void {
    this.commands.push({ kind: "destroy", entity });
  }

  add(entity: EntityId, componentId: number, value: ComponentFieldValues): void {
    this.commands.push({ kind: "add", entity, componentId, value });
  }

  remove(entity: EntityId, componentId: number): void {
    this.commands.push({ kind: "remove", entity, componentId });
  }

  get length(): number {
    return this.commands.length;
  }

  /** Empties the buffer and returns everything that was queued, in order. */
  drain(): Command[] {
    const drained = this.commands;
    this.commands = [];
    return drained;
  }
}

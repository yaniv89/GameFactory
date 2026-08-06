import { Archetype } from "./archetype";
import { CommandBuffer, type ComponentFieldValues } from "./commandBuffer";
import {
  ComponentRegistry,
  type ComponentSchema,
  type ComponentValue,
} from "./component";
import { EntityAllocator, entityIndex, type EntityId } from "./entity";
import {
  cloneMask,
  clearBit,
  createMask,
  maskContainsAll,
  maskKey,
  setBit,
  type ComponentMask,
} from "./mask";
import { Query } from "./query";

interface EntityLocation {
  archetype: Archetype;
  row: number;
}

/**
 * The ECS world: entity lifecycle, archetype storage, and queries, per
 * docs/SPEC.md Section 4.2 and Section 8.4. Reads (get/has/isAlive/query)
 * always reflect the last-flushed state; writes that change archetype
 * membership (create/destroy/add/remove) are deferred to `flush()` — see
 * CommandBuffer's doc comment. `set()` is the one write that applies
 * immediately, because it never moves an entity between archetypes.
 */
export class World {
  readonly components = new ComponentRegistry();

  private readonly allocator = new EntityAllocator();
  private readonly archetypesByKey = new Map<string, Archetype>();
  private readonly allArchetypes: Archetype[] = [];
  private readonly locationByIndex: (EntityLocation | undefined)[] = [];
  private readonly commandBuffer = new CommandBuffer();
  private readonly emptyArchetype: Archetype;
  private _archetypeVersion = 0;

  constructor() {
    this.emptyArchetype = this.getOrCreateArchetype(createMask(), []);
  }

  get archetypeVersion(): number {
    return this._archetypeVersion;
  }

  get entityCount(): number {
    return this.allocator.count;
  }

  get pendingCommandCount(): number {
    return this.commandBuffer.length;
  }

  /** Highest entity index ever allocated + 1 — save/load's `SavedWorld.nextEntityId` (packages/core/src/save/serialize.ts). */
  get entityIndexBound(): number {
    return this.allocator.indexBound;
  }

  defineComponent<S extends ComponentSchema>(
    name: string,
    schema: S,
    defaults: ComponentValue<S>,
  ) {
    return this.components.define(name, schema, defaults);
  }

  private getOrCreateArchetype(mask: ComponentMask, componentIds: readonly number[]): Archetype {
    const key = maskKey(mask);
    let archetype = this.archetypesByKey.get(key);
    if (!archetype) {
      const descriptors = componentIds.map((id) => this.components.getById(id));
      archetype = new Archetype(cloneMask(mask), descriptors);
      this.archetypesByKey.set(key, archetype);
      this.allArchetypes.push(archetype);
      this._archetypeVersion++;
    }
    return archetype;
  }

  /** @internal used by Query */
  archetypesMatching(required: ComponentMask): Archetype[] {
    const matches: Archetype[] = [];
    for (const archetype of this.allArchetypes) {
      if (maskContainsAll(archetype.mask, required)) matches.push(archetype);
    }
    return matches;
  }

  query(componentNames: readonly string[]): Query {
    const mask = createMask();
    for (const name of componentNames) {
      setBit(mask, this.components.getByName(name).id);
    }
    return new Query(mask, this);
  }

  /**
   * Allocates the entity ID synchronously (safe: it never touches
   * archetypes) and defers placement — including any initial component
   * values — to the next flush().
   */
  create(initial?: Readonly<Record<string, ComponentFieldValues>>): EntityId {
    const entity = this.allocator.create();
    const componentsMap = new Map<number, ComponentFieldValues>();
    if (initial) {
      for (const name of Object.keys(initial)) {
        componentsMap.set(this.components.getByName(name).id, { ...initial[name] });
      }
    }
    this.commandBuffer.create(entity, componentsMap);
    return entity;
  }

  destroy(entity: EntityId): void {
    this.commandBuffer.destroy(entity);
  }

  /**
   * Places `entity` directly into its archetype at exactly the given id,
   * bypassing the CommandBuffer — save/load only, never called mid-tick.
   * Applies immediately (no flush needed) since it's meant to run in a
   * tight loop reconstructing a whole world from a save file, where
   * deferring to a later flush() would serve no purpose. The world this
   * is called on is expected to be freshly constructed (no pre-existing
   * entities) — restoring into a live world isn't a supported use case.
   */
  restoreEntity(entity: EntityId, components: Readonly<Record<string, ComponentFieldValues>>): void {
    this.allocator.restore(entity);
    const mask = createMask();
    const componentIds: number[] = [];
    for (const name of Object.keys(components)) {
      const id = this.components.getByName(name).id;
      setBit(mask, id);
      componentIds.push(id);
    }
    componentIds.sort((a, b) => a - b);

    const archetype = componentIds.length === 0 ? this.emptyArchetype : this.getOrCreateArchetype(mask, componentIds);
    const row = archetype.addEntity(entity);
    for (const name of Object.keys(components)) {
      this.writeValues(archetype, this.components.getByName(name).id, row, components[name]!);
    }
    this.setLocation(entity, { archetype, row });
  }

  add(entity: EntityId, componentName: string, value: ComponentFieldValues): void {
    this.commandBuffer.add(entity, this.components.getByName(componentName).id, { ...value });
  }

  remove(entity: EntityId, componentName: string): void {
    this.commandBuffer.remove(entity, this.components.getByName(componentName).id);
  }

  isAlive(entity: EntityId): boolean {
    return this.allocator.isAlive(entity);
  }

  has(entity: EntityId, componentName: string): boolean {
    const location = this.locationOf(entity);
    if (!location) return false;
    return location.archetype.hasComponent(this.components.getByName(componentName).id);
  }

  /** Every component name `entity` currently carries. Empty array for a dead or componentless entity. Used by save/load to enumerate what to serialize without the caller having to already know an entity's shape. */
  componentsOf(entity: EntityId): readonly string[] {
    const location = this.locationOf(entity);
    if (!location) return [];
    return location.archetype.componentIds.map((id) => this.components.getById(id).name);
  }

  get<S extends ComponentSchema>(
    entity: EntityId,
    componentName: string,
  ): ComponentValue<S> | undefined {
    const location = this.locationOf(entity);
    if (!location) return undefined;
    const descriptor = this.components.getByName(componentName);
    if (!location.archetype.hasComponent(descriptor.id)) return undefined;
    const columns = location.archetype.column(descriptor.id);
    const result: Record<string, number> = {};
    for (const field of Object.keys(descriptor.schema)) {
      result[field] = columns[field]![location.row]!;
    }
    return result as ComponentValue<S>;
  }

  /** Direct write to an existing component's fields. Applies immediately — never moves the entity between archetypes. */
  set(entity: EntityId, componentName: string, value: Readonly<Partial<Record<string, number>>>): void {
    const location = this.locationOf(entity);
    if (!location) {
      throw new Error(`World.set: entity ${entity} does not exist`);
    }
    const descriptor = this.components.getByName(componentName);
    if (!location.archetype.hasComponent(descriptor.id)) {
      throw new Error(`World.set: entity ${entity} does not have component "${componentName}"`);
    }
    const columns = location.archetype.column(descriptor.id);
    for (const field of Object.keys(value)) {
      const v = value[field];
      if (v !== undefined) columns[field]![location.row] = v;
    }
  }

  private locationOf(entity: EntityId): EntityLocation | undefined {
    if (!this.allocator.isAlive(entity)) return undefined;
    return this.locationByIndex[entityIndex(entity)];
  }

  private setLocation(entity: EntityId, location: EntityLocation): void {
    this.locationByIndex[entityIndex(entity)] = location;
  }

  private clearLocation(entity: EntityId): void {
    this.locationByIndex[entityIndex(entity)] = undefined;
  }

  /** Applies every queued create/destroy/add/remove, in the order they were issued. */
  flush(): void {
    const commands = this.commandBuffer.drain();
    for (const command of commands) {
      switch (command.kind) {
        case "create":
          this.applyCreate(command.entity, command.components);
          break;
        case "destroy":
          this.applyDestroy(command.entity);
          break;
        case "add":
          this.applyAdd(command.entity, command.componentId, command.value);
          break;
        case "remove":
          this.applyRemove(command.entity, command.componentId);
          break;
      }
    }
  }

  private writeValues(archetype: Archetype, componentId: number, row: number, value: ComponentFieldValues): void {
    const columns = archetype.column(componentId);
    for (const field of Object.keys(value)) {
      const v = value[field];
      if (v !== undefined) columns[field]![row] = v;
    }
  }

  private copyComponent(
    from: Archetype,
    fromRow: number,
    to: Archetype,
    toRow: number,
    componentId: number,
  ): void {
    const descriptor = this.components.getById(componentId);
    const fromColumns = from.column(componentId);
    const toColumns = to.column(componentId);
    for (const field of Object.keys(descriptor.schema)) {
      toColumns[field]![toRow] = fromColumns[field]![fromRow]!;
    }
  }

  private applyCreate(entity: EntityId, components: ReadonlyMap<number, ComponentFieldValues>): void {
    // Not alive means it was destroyed before this flush ran (create+destroy in the same tick) — nothing to place.
    if (!this.allocator.isAlive(entity)) return;

    const mask = createMask();
    const componentIds: number[] = [];
    for (const id of components.keys()) {
      setBit(mask, id);
      componentIds.push(id);
    }
    componentIds.sort((a, b) => a - b);

    const archetype =
      componentIds.length === 0 ? this.emptyArchetype : this.getOrCreateArchetype(mask, componentIds);
    const row = archetype.addEntity(entity);
    for (const [componentId, value] of components) {
      this.writeValues(archetype, componentId, row, value);
    }
    this.setLocation(entity, { archetype, row });
  }

  private applyDestroy(entity: EntityId): void {
    if (!this.allocator.isAlive(entity)) return; // already gone (double-destroy, or created+destroyed same tick)
    const location = this.locationByIndex[entityIndex(entity)];
    if (location) {
      const movedEntity = location.archetype.removeEntity(location.row);
      if (movedEntity !== undefined) {
        this.setLocation(movedEntity, { archetype: location.archetype, row: location.row });
      }
      this.clearLocation(entity);
    }
    this.allocator.destroy(entity);
  }

  private applyAdd(entity: EntityId, componentId: number, value: ComponentFieldValues): void {
    if (!this.allocator.isAlive(entity)) return;
    const location = this.locationByIndex[entityIndex(entity)];
    const currentArchetype = location?.archetype ?? this.emptyArchetype;

    if (currentArchetype.hasComponent(componentId)) {
      // Already carries this component: overwrite in place, no archetype move.
      this.writeValues(currentArchetype, componentId, location!.row, value);
      return;
    }

    const newMask = cloneMask(currentArchetype.mask);
    setBit(newMask, componentId);
    const newComponentIds = [...currentArchetype.componentIds, componentId].sort((a, b) => a - b);
    const newArchetype = this.getOrCreateArchetype(newMask, newComponentIds);
    const newRow = newArchetype.addEntity(entity);

    if (location) {
      for (const existingId of currentArchetype.componentIds) {
        this.copyComponent(currentArchetype, location.row, newArchetype, newRow, existingId);
      }
      const movedEntity = currentArchetype.removeEntity(location.row);
      if (movedEntity !== undefined) {
        this.setLocation(movedEntity, { archetype: currentArchetype, row: location.row });
      }
    }

    this.writeValues(newArchetype, componentId, newRow, value);
    this.setLocation(entity, { archetype: newArchetype, row: newRow });
  }

  private applyRemove(entity: EntityId, componentId: number): void {
    if (!this.allocator.isAlive(entity)) return;
    const location = this.locationByIndex[entityIndex(entity)];
    if (!location || !location.archetype.hasComponent(componentId)) return;

    const currentArchetype = location.archetype;
    const newMask = cloneMask(currentArchetype.mask);
    clearBit(newMask, componentId);
    const newComponentIds = currentArchetype.componentIds.filter((id) => id !== componentId);
    const newArchetype =
      newComponentIds.length === 0 ? this.emptyArchetype : this.getOrCreateArchetype(newMask, newComponentIds);
    const newRow = newArchetype.addEntity(entity);

    for (const keepId of newComponentIds) {
      this.copyComponent(currentArchetype, location.row, newArchetype, newRow, keepId);
    }
    const movedEntity = currentArchetype.removeEntity(location.row);
    if (movedEntity !== undefined) {
      this.setLocation(movedEntity, { archetype: currentArchetype, row: location.row });
    }
    this.setLocation(entity, { archetype: newArchetype, row: newRow });
  }
}

import type { EntityId } from "@forge/module-api";

export const DEFAULT_CAPACITY_SLOTS = 20;
export const INVENTORY_CAPACITY_COMPONENT = "InventoryCapacity";

/** ECS component: only entities that need a non-default capacity carry this. */
export interface InventoryCapacityShape extends Record<string, number | boolean> {
  maxSlots: number;
}

/** One entity's held items, keyed by item id — persisted via `storage`, namespaced `inv:<entityId>` (SPEC 8.5's `globals`), not an ECS component: item counts don't fit a fixed numeric field schema. */
export type InventoryContents = Readonly<Record<string, number>>;

export interface AddItemEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  readonly qty: number;
}
export interface RemoveItemEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  readonly qty: number;
}
export interface BuyItemEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  readonly qty: number;
  readonly vendor: EntityId;
  readonly basePrice: number;
}
export interface InventoryChangedEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  /** Total quantity held after the change (0 if the stack was fully removed). */
  readonly qty: number;
}
export interface InventoryRejectedEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  readonly qty: number;
  readonly reason: "capacity";
}
export interface PurchaseEvent {
  readonly entity: EntityId;
  readonly itemId: string;
  readonly qty: number;
  readonly totalPrice: number;
}
export interface QueryInventoryEvent {
  readonly entity: EntityId;
}
export interface InventoryQueriedEvent {
  readonly entity: EntityId;
  readonly items: InventoryContents;
}

export function storageKey(entity: EntityId): string {
  return `inv:${entity}`;
}

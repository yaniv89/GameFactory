import type { EntityId, ForgeModule, SetupContext } from "@forge/module-api";
import {
  DEFAULT_CAPACITY_SLOTS,
  INVENTORY_CAPACITY_COMPONENT,
  storageKey,
  type AddItemEvent,
  type BuyItemEvent,
  type InventoryCapacityShape,
  type InventoryChangedEvent,
  type InventoryContents,
  type InventoryQueriedEvent,
  type InventoryRejectedEvent,
  type PurchaseEvent,
  type QueryInventoryEvent,
  type RemoveItemEvent,
} from "./types";

export * from "./types";

/**
 * @forge/inventory — per-entity item stacks, built entirely against
 * @forge/module-api. Contents live in `storage` (namespaced `inv:<entity>`)
 * rather than an ECS component: an item stack list doesn't fit the fixed
 * number/boolean component field schema (docs/SPEC.md Section 4.2), and
 * `storage` is exactly the mechanism SPEC 8.5's save format expects for
 * this kind of module-owned state (it lands in `SaveFile.globals`).
 * `InventoryCapacity` *is* a real ECS component — an optional per-entity
 * slot-limit override — demonstrating `defineComponent`/`ctx.world`
 * alongside the storage-backed path.
 *
 * `inventory:canAddItem` and `inventory:itemPrice`
 * (`@forge/module-api`'s `InterceptorMap`) are triggered via
 * `ctx.runInterceptor` (docs/adr/0006) for every add and every purchase,
 * so another module can veto a pickup or apply a discount without this
 * module knowing it exists.
 */
export const inventoryModule: ForgeModule = {
  setup(ctx: SetupContext): void {
    ctx.defineComponent<InventoryCapacityShape>(
      INVENTORY_CAPACITY_COMPONENT,
      { maxSlots: { type: "number" } },
      { maxSlots: DEFAULT_CAPACITY_SLOTS },
    );

    function getContents(entity: EntityId): Record<string, number> {
      return { ...(ctx.storage.get<InventoryContents>(storageKey(entity)) ?? {}) };
    }

    function capacityFor(entity: EntityId): number {
      if (ctx.world.has(entity, INVENTORY_CAPACITY_COMPONENT)) {
        return ctx.world.get<InventoryCapacityShape>(entity, INVENTORY_CAPACITY_COMPONENT)!.maxSlots;
      }
      return DEFAULT_CAPACITY_SLOTS;
    }

    ctx.events.on("inventory:add", (payload) => {
      const { entity, itemId, qty } = payload as AddItemEvent;
      if (qty <= 0) {
        ctx.log.warn("inventory:add with a non-positive qty was ignored", { entity, itemId, qty });
        return;
      }
      const items = getContents(entity);
      const isNewStack = !(itemId in items);
      const currentSlots = Object.keys(items).length;

      const decision = ctx.runInterceptor("inventory:canAddItem", {
        entity,
        itemId,
        qty,
        allowed: !isNewStack || currentSlots < capacityFor(entity),
      });

      if (!decision.allowed) {
        ctx.events.emit("inventory:rejected", { entity, itemId, qty, reason: "capacity" } satisfies InventoryRejectedEvent);
        return;
      }

      items[itemId] = (items[itemId] ?? 0) + qty;
      ctx.storage.set(storageKey(entity), items);
      ctx.events.emit("inventory:changed", { entity, itemId, qty: items[itemId] } satisfies InventoryChangedEvent);
    });

    ctx.events.on("inventory:remove", (payload) => {
      const { entity, itemId, qty } = payload as RemoveItemEvent;
      const items = getContents(entity);
      const have = items[itemId] ?? 0;
      if (have < qty) {
        ctx.log.warn("inventory:remove requested more than the entity holds", { entity, itemId, requested: qty, have });
        return;
      }
      const remaining = have - qty;
      if (remaining === 0) delete items[itemId];
      else items[itemId] = remaining;
      ctx.storage.set(storageKey(entity), items);
      ctx.events.emit("inventory:changed", { entity, itemId, qty: remaining } satisfies InventoryChangedEvent);
    });

    ctx.events.on("inventory:buy", (payload) => {
      const { entity, itemId, qty, vendor, basePrice } = payload as BuyItemEvent;
      const price = ctx.runInterceptor("inventory:itemPrice", { itemId, basePrice, vendor });
      ctx.events.emit("inventory:purchase", {
        entity,
        itemId,
        qty,
        totalPrice: price.basePrice * qty,
      } satisfies PurchaseEvent);
      ctx.events.emit("inventory:add", { entity, itemId, qty } satisfies AddItemEvent);
    });

    ctx.events.on("inventory:query", (payload) => {
      const { entity } = payload as QueryInventoryEvent;
      ctx.events.emit("inventory:queried", { entity, items: getContents(entity) } satisfies InventoryQueriedEvent);
    });
  },
};

export default inventoryModule;

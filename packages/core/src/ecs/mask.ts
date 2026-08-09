import { MAX_COMPONENT_TYPES } from "./component";

/**
 * A fixed-width bitset identifying an archetype's component set. Sized for
 * MAX_COMPONENT_TYPES (256) up front — one allocation at world creation,
 * never per-tick or per-query.
 */
export type ComponentMask = Uint32Array;

const WORD_BITS = 32;
export const MASK_WORDS = MAX_COMPONENT_TYPES / WORD_BITS;

export function createMask(): ComponentMask {
  return new Uint32Array(MASK_WORDS);
}

export function cloneMask(mask: ComponentMask): ComponentMask {
  return mask.slice() as ComponentMask;
}

export function setBit(mask: ComponentMask, id: number): void {
  const word = id >>> 5;
  mask[word] = (mask[word] ?? 0) | (1 << (id & 31));
}

export function clearBit(mask: ComponentMask, id: number): void {
  const word = id >>> 5;
  mask[word] = (mask[word] ?? 0) & ~(1 << (id & 31));
}

export function hasBit(mask: ComponentMask, id: number): boolean {
  const word = id >>> 5;
  return ((mask[word] ?? 0) & (1 << (id & 31))) !== 0;
}

/** True if `superset` contains every bit set in `subset`. */
export function maskContainsAll(superset: ComponentMask, subset: ComponentMask): boolean {
  for (let i = 0; i < MASK_WORDS; i++) {
    const need = subset[i] ?? 0;
    if ((( superset[i] ?? 0) & need) !== need) return false;
  }
  return true;
}

export function maskEquals(a: ComponentMask, b: ComponentMask): boolean {
  for (let i = 0; i < MASK_WORDS; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

/** Stable string key for use as a Map key (archetype lookup by component set). */
export function maskKey(mask: ComponentMask): string {
  let key = "";
  for (let i = 0; i < MASK_WORDS; i++) {
    key += (mask[i] ?? 0).toString(16) + ":";
  }
  return key;
}

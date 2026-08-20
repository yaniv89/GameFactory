import type { ComponentFieldValues } from "@forge/core";

/**
 * I1f: local dev-preview persistence — a reload of the editor no longer
 * discards the live preview's player progress. This is deliberately NOT
 * M7 Phase 7's cloud save system (already built: `services/Forge.Api`'s
 * play services, Azure Table Storage, cross-device) and NOT the project
 * document / revision-history system (`projectStore.ts`) — it is one
 * browser-local slot that survives only a reload, the same "dev
 * convenience, not a product feature" scope `directModuleHost.ts`'s own
 * doc comment already draws around the unsandboxed module-runtime path it
 * sits next to.
 *
 * The functions here run in `PreviewPanel.tsx` (the editor origin), NOT
 * inside the preview iframe (`PreviewApp.tsx`) — confirmed the hard way,
 * not assumed: the iframe is `sandbox="allow-scripts"` with no
 * `allow-same-origin` (`PreviewPanel.tsx`'s own doc comment), which gives
 * it a browser-enforced opaque origin, and `window.localStorage` throws a
 * `SecurityError` ("The document is sandboxed and lacks the
 * 'allow-same-origin' flag") from inside an opaque-origin document. The
 * preview iframe instead ships its save *out* to the parent over the
 * existing postMessage bridge (`protocol.ts`'s `PreviewSaveMessage`) and
 * receives its restore data *in* on `PreviewSceneMessage.devSave` — the
 * parent is the only side of this bridge with a real, storable origin.
 *
 * Scope is deliberately narrow: only the player entity's own components
 * (position, health, equipment shape) and the real `@forge/inventory`
 * module's storage (item counts) are saved — not the whole world. The demo
 * enemy and mount are session fixtures, freshly (re)spawned every boot
 * exactly as they are today; persisting their combat/ride state would mean
 * solving entity-identity across a full-world restore (an enemy killed
 * before reload has no corresponding live entity to restore against) for
 * no real player-facing benefit, since nothing about "where the demo
 * enemy currently is" is progress a player would expect to keep. This is
 * an explicit, stated boundary, not a silent gap.
 *
 * There is intentionally no scene/project id in `protocol.ts`'s
 * `PreviewSceneMessage` to key multiple save slots by yet — the preview is
 * a single fixed demo map today. One fixed storage key is therefore
 * correct for what exists now; a real multi-project key would be part of
 * whatever gives the preview its own project id in the first place.
 */

const STORAGE_KEY = "forge:preview:dev-save:v1";

export interface DevPreviewSave {
  /** The player entity's own components at save time, from `serializeEntity` (@forge/core). Mount-riding/wielded-weapon fields are sanitized back to their "not equipped" defaults by the caller before restoring — see `PreviewApp.tsx`'s own doc comment on `sanitizeRestoredPlayerComponents`. */
  readonly player: Readonly<Record<string, ComponentFieldValues>>;
  /** The real `@forge/inventory` module's own storage, from `ModuleRuntime.snapshotStorage()`. */
  readonly inventory: Readonly<Record<string, unknown>>;
  readonly savedAt: string;
}

function isComponentFieldValues(value: unknown): value is ComponentFieldValues {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((field) => typeof field === "number" && Number.isFinite(field));
}

/**
 * Structural validation for a `DevPreviewSave` crossing a trust boundary —
 * either a hand-edited/corrupted `localStorage` value, or (defense in
 * depth, CLAUDE.md 4.6) a `PreviewSaveMessage` arriving over the postMessage
 * bridge from the preview iframe. Not exhaustive against every registered
 * `@forge/core` component schema (that would mean importing the whole
 * component registry into this shared, otherwise-registry-agnostic module
 * for a dev-only save) — just enough shape-checking that a malformed
 * value can never reach `world.create()` and throw an unhandled exception
 * out of the preview's own boot sequence.
 */
export function isValidDevPreviewSave(value: unknown): value is DevPreviewSave {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { player?: unknown; inventory?: unknown; savedAt?: unknown };
  if (typeof candidate.player !== "object" || candidate.player === null) return false;
  if (!Object.values(candidate.player).every(isComponentFieldValues)) return false;
  if (typeof candidate.inventory !== "object" || candidate.inventory === null) return false;
  if (typeof candidate.savedAt !== "string") return false;
  return true;
}

/**
 * Writes `save` to this browser's `localStorage`. A quota/private-browsing
 * failure is logged, not thrown or silently swallowed (CLAUDE.md 1.2.11) —
 * losing an autosave is a real but non-fatal outcome visible in devtools,
 * not a crash of the editor itself.
 */
export function saveDevPreview(save: DevPreviewSave): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("[forge:preview] dev-preview save failed", err);
  }
}

/**
 * Reads back the last `saveDevPreview` write, or `null` if there is none,
 * it fails to parse, or it doesn't structurally look like a
 * `DevPreviewSave` (a manually-edited/corrupted `localStorage` value) —
 * discarded rather than thrown, so a bad save can never strand the editor
 * in the error state on every future boot.
 */
export function loadDevPreview(): DevPreviewSave | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[forge:preview] dev-preview save was corrupt JSON — discarding", err);
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  if (!isValidDevPreviewSave(parsed)) {
    console.warn("[forge:preview] dev-preview save didn't match the expected shape — discarding");
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return parsed;
}

export function clearDevPreview(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

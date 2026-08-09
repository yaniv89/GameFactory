import * as Y from "yjs";

/**
 * docs/SPEC.md Section 12.4: "The document is a Y.Doc with a sub-map
 * per scene, entity and table, so two users editing different scenes
 * never contend." Top-level shape here: a `Y.Map<Y.Map>` keyed by scene
 * id; each scene's own `Y.Map` holds a `"tiles"` entry. Entity and table
 * sub-maps are a real, separate follow-on (this phase's exit criterion
 * — SPEC 12.4's "two users co-edit the same tilemap layer" — is scoped
 * to tiles only; a stated gap, not a silent one).
 *
 * Tile storage: SPEC 12.4 literally says "Model each tilemap layer as a
 * Y.Array of tile IDs so resolution is per-tile last-write-wins." Tried
 * exactly that first, and verified empirically (a real Yjs script, not
 * assumed) that it does NOT deliver per-tile last-write-wins: `Y.Array`'s
 * delete-then-insert pattern for "set index i" lets two concurrent
 * writes to the *same* index both survive as separate insertions next
 * to each other — a 5-tile layer painted concurrently at the same tile
 * by two peers grew to 6 elements with both values present, not one
 * winner. That is the opposite of the property this exact scenario (the
 * SPEC's own named "contention hotspot") needs. `Y.Array`'s
 * ordered-sequence CRDT is built to preserve concurrent inserts — that's
 * what makes collaborative rich text work — not to collapse them; it's
 * the wrong primitive for a fixed-size grid where a cell must end up
 * with exactly one value. A `Y.Map` keyed by flat tile index genuinely
 * gives last-write-wins per key (verified the same way: two concurrent
 * `Map.set` calls on the same key converge deterministically to one
 * winner, and the map's size stays fixed). This delivers the SPEC's
 * *stated requirement* even though it departs from its literal
 * "Y.Array" wording — see `collabDoc.test.ts` for the convergence proof.
 */

const SCENES_KEY = "scenes";
const TILES_KEY = "tiles";

export function createCollabDoc(): Y.Doc {
  return new Y.Doc();
}

function getSceneMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(SCENES_KEY);
}

function getOrCreateScene(doc: Y.Doc, sceneId: string): Y.Map<unknown> {
  const scenes = getSceneMap(doc);
  let scene = scenes.get(sceneId);
  if (!scene) {
    scene = new Y.Map();
    scenes.set(sceneId, scene);
  }
  return scene;
}

/** The tile layer for `sceneId` — a `Y.Map<number>` keyed by flat tile index ("0".."299" for a 20x15 grid) — created empty if this is the first access. */
export function getTileLayer(doc: Y.Doc, sceneId: string): Y.Map<number> {
  const scene = getOrCreateScene(doc, sceneId);
  let tiles = scene.get(TILES_KEY) as Y.Map<number> | undefined;
  if (!tiles) {
    tiles = new Y.Map<number>();
    scene.set(TILES_KEY, tiles);
  }
  return tiles;
}

/**
 * Seeds a tile layer's initial values from a flat tile array (project
 * load). Only fills entries that don't already exist, so calling this
 * again — e.g. a second client opening the same scene after remote
 * paints already arrived — can't clobber real collaborator work with
 * stale local data.
 */
export function seedTileLayer(doc: Y.Doc, sceneId: string, tiles: readonly number[]): void {
  const layer = getTileLayer(doc, sceneId);
  doc.transact(() => {
    tiles.forEach((tileId, index) => {
      if (!layer.has(String(index))) layer.set(String(index), tileId);
    });
  });
}

/** Paints one tile — the real per-cell write two co-editors' concurrent calls converge on (last write wins, per this file's own doc comment). */
export function paintTile(doc: Y.Doc, sceneId: string, index: number, tileId: number): void {
  getTileLayer(doc, sceneId).set(String(index), tileId);
}

/** Reads the tile layer back out as a flat array for the renderer/store. `fallbackTileId` fills any index nothing has painted yet. */
export function readTileLayer(doc: Y.Doc, sceneId: string, tileCount: number, fallbackTileId: number): number[] {
  const layer = getTileLayer(doc, sceneId);
  const result = new Array<number>(tileCount).fill(fallbackTileId);
  layer.forEach((value, key) => {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < tileCount) result[index] = value;
  });
  return result;
}

/** Subscribes to remote (or local) changes on a scene's tile layer; returns the unsubscribe function. */
export function observeTileLayer(doc: Y.Doc, sceneId: string, onChange: () => void): () => void {
  const layer = getTileLayer(doc, sceneId);
  const handler = (): void => onChange();
  layer.observe(handler);
  return () => layer.unobserve(handler);
}

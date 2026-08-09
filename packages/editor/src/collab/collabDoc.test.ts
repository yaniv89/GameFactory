import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createCollabDoc, observeTileLayer, paintTile, readTileLayer, seedTileLayer } from "./collabDoc";

describe("collabDoc", () => {
  it("seeds and reads back a flat tile layer", () => {
    const doc = createCollabDoc();
    seedTileLayer(doc, "scene-1", [1, 1, 1, 4, 1]);
    expect(readTileLayer(doc, "scene-1", 5, 0)).toEqual([1, 1, 1, 4, 1]);
  });

  it("two peers painting different tiles concurrently both survive — no lost work", () => {
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", new Array(9).fill(1));
    const docB = createCollabDoc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    paintTile(docA, "scene-1", 2, 4); // A paints tile 2
    paintTile(docB, "scene-1", 6, 9); // B paints a different tile, 6

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const expected = new Array(9).fill(1);
    expected[2] = 4;
    expected[6] = 9;
    expect(readTileLayer(docA, "scene-1", 9, 0)).toEqual(expected);
    expect(readTileLayer(docB, "scene-1", 9, 0)).toEqual(expected);
  });

  it("two peers painting the SAME tile concurrently converge to one deterministic winner, not both", () => {
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", new Array(5).fill(0));
    const docB = createCollabDoc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    paintTile(docA, "scene-1", 2, 111);
    paintTile(docB, "scene-1", 2, 222);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const layerA = readTileLayer(docA, "scene-1", 5, 0);
    const layerB = readTileLayer(docB, "scene-1", 5, 0);
    expect(layerA).toEqual(layerB); // both peers converge on the same winner
    expect(layerA).toHaveLength(5); // fixed grid size preserved — the exact property a naive Y.Array approach breaks (see collabDoc.ts's own doc comment)
    expect([111, 222]).toContain(layerA[2]); // one of the two concurrent writes won, deterministically
  });

  it("scenes are independent — painting one scene's layer never touches another's", () => {
    const doc = createCollabDoc();
    seedTileLayer(doc, "scene-1", [1, 1]);
    seedTileLayer(doc, "scene-2", [2, 2]);
    paintTile(doc, "scene-1", 0, 9);
    expect(readTileLayer(doc, "scene-1", 2, 0)).toEqual([9, 1]);
    expect(readTileLayer(doc, "scene-2", 2, 0)).toEqual([2, 2]);
  });

  it("seedTileLayer never overwrites an index a remote peer already painted", () => {
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", [1, 1, 1]);
    const docB = createCollabDoc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    paintTile(docB, "scene-1", 1, 7);
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // A "reloads" and seeds again from its own (now stale) flat array —
    // must not clobber B's real paint that already arrived.
    seedTileLayer(docA, "scene-1", [1, 1, 1]);
    expect(readTileLayer(docA, "scene-1", 3, 0)).toEqual([1, 7, 1]);
  });

  it("notifies observers on change, and stops after unobserving", () => {
    const doc = createCollabDoc();
    seedTileLayer(doc, "scene-1", [1, 1]);
    let calls = 0;
    const unobserve = observeTileLayer(doc, "scene-1", () => {
      calls++;
    });

    paintTile(doc, "scene-1", 0, 4);
    expect(calls).toBe(1);

    unobserve();
    paintTile(doc, "scene-1", 1, 4);
    expect(calls).toBe(1);
  });
});

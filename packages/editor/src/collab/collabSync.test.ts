import { describe, expect, it, vi } from "vitest";
import { createCollabDoc, paintTile, readTileLayer, seedTileLayer } from "./collabDoc";
import { wireCollabDocToRelay, type CollabRelay } from "./collabSync";

type Listener<T extends unknown[]> = (...args: T) => void;

/**
 * An in-process stand-in for CollabHub's own relay behavior: every peer
 * created from the same bus is a "group member," matching
 * `PublishUpdate`/`RequestSync` (broadcast to everyone else) and
 * `SendSyncTo` (delivered to exactly one named peer) exactly. No
 * network, no SignalR — this proves `wireCollabDocToRelay`'s own logic
 * (convergence, echo-loop prevention, join sync) directly.
 */
class TestCollabBus {
  private readonly peers = new Map<
    string,
    { onUpdate: Set<Listener<[Uint8Array]>>; onSyncRequested: Set<Listener<[string]>>; onSync: Set<Listener<[Uint8Array]>> }
  >();

  createRelay(connectionId: string): CollabRelay {
    const entry = { onUpdate: new Set<Listener<[Uint8Array]>>(), onSyncRequested: new Set<Listener<[string]>>(), onSync: new Set<Listener<[Uint8Array]>>() };
    this.peers.set(connectionId, entry);

    return {
      publishUpdate: (update) => {
        for (const [otherId, other] of this.peers) {
          if (otherId === connectionId) continue;
          other.onUpdate.forEach((handler) => handler(update));
        }
      },
      onUpdate: (handler) => {
        entry.onUpdate.add(handler);
        return () => entry.onUpdate.delete(handler);
      },
      requestSync: () => {
        for (const [otherId, other] of this.peers) {
          if (otherId === connectionId) continue;
          other.onSyncRequested.forEach((handler) => handler(connectionId));
        }
      },
      onSyncRequested: (handler) => {
        entry.onSyncRequested.add(handler);
        return () => entry.onSyncRequested.delete(handler);
      },
      sendSyncTo: (targetConnectionId, update) => {
        this.peers.get(targetConnectionId)?.onSync.forEach((handler) => handler(update));
      },
      onSync: (handler) => {
        entry.onSync.add(handler);
        return () => entry.onSync.delete(handler);
      },
    };
  }
}

describe("wireCollabDocToRelay", () => {
  it("a late-joining peer receives a full sync from an already-connected peer", () => {
    const bus = new TestCollabBus();

    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", [1, 1, 4, 1]);
    wireCollabDocToRelay(docA, bus.createRelay("a"));

    const docB = createCollabDoc(); // starts empty
    wireCollabDocToRelay(docB, bus.createRelay("b")); // requestSync() fires as part of wiring

    expect(readTileLayer(docB, "scene-1", 4, 0)).toEqual([1, 1, 4, 1]);
  });

  it("local edits on one peer propagate to the other", () => {
    const bus = new TestCollabBus();
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", new Array(9).fill(1));
    wireCollabDocToRelay(docA, bus.createRelay("a"));

    const docB = createCollabDoc();
    wireCollabDocToRelay(docB, bus.createRelay("b"));
    expect(readTileLayer(docB, "scene-1", 9, 0)).toEqual(new Array(9).fill(1));

    paintTile(docA, "scene-1", 4, 7);

    expect(readTileLayer(docB, "scene-1", 9, 0)[4]).toBe(7);
  });

  it("relaying a remote update does not echo it back out (no infinite loop, no duplicate publish)", () => {
    const bus = new TestCollabBus();
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", [1, 1, 1]);
    const relayA = bus.createRelay("a");
    const publishSpyA = vi.fn(relayA.publishUpdate.bind(relayA));
    relayA.publishUpdate = publishSpyA;
    wireCollabDocToRelay(docA, relayA);

    const docB = createCollabDoc();
    const relayB = bus.createRelay("b");
    const publishSpyB = vi.fn(relayB.publishUpdate.bind(relayB));
    relayB.publishUpdate = publishSpyB;
    wireCollabDocToRelay(docB, relayB);

    publishSpyA.mockClear();
    publishSpyB.mockClear();

    paintTile(docA, "scene-1", 0, 9); // exactly one real local edit

    expect(publishSpyA).toHaveBeenCalledTimes(1); // A published its own edit once
    expect(publishSpyB).not.toHaveBeenCalled(); // B only applied the relayed update, never re-published it
    expect(readTileLayer(docB, "scene-1", 3, 0)).toEqual([9, 1, 1]);
  });

  it("two peers painting different tiles concurrently (before either has seen the other's edit) both survive once relayed", () => {
    const bus = new TestCollabBus();
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", new Array(5).fill(1));
    wireCollabDocToRelay(docA, bus.createRelay("a"));

    const docB = createCollabDoc();
    wireCollabDocToRelay(docB, bus.createRelay("b"));

    paintTile(docA, "scene-1", 1, 4);
    paintTile(docB, "scene-1", 3, 4);

    const expected = [1, 4, 1, 4, 1];
    expect(readTileLayer(docA, "scene-1", 5, 0)).toEqual(expected);
    expect(readTileLayer(docB, "scene-1", 5, 0)).toEqual(expected);
  });

  it("cleanup stops relaying local edits and stops applying remote ones", () => {
    const bus = new TestCollabBus();
    const docA = createCollabDoc();
    seedTileLayer(docA, "scene-1", [1, 1]);
    const unwireA = wireCollabDocToRelay(docA, bus.createRelay("a"));

    const docB = createCollabDoc();
    wireCollabDocToRelay(docB, bus.createRelay("b"));
    expect(readTileLayer(docB, "scene-1", 2, 0)).toEqual([1, 1]);

    unwireA();
    paintTile(docA, "scene-1", 0, 9);

    expect(readTileLayer(docB, "scene-1", 2, 0)).toEqual([1, 1]); // never arrived — A stopped relaying
  });
});

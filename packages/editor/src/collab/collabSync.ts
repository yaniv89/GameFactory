import * as Y from "yjs";

/**
 * What `wireCollabDocToRelay` needs from a transport — deliberately not
 * `HubConnection` itself, so the sync logic below is testable with two
 * in-memory docs and a fake in-process relay (`collabSync.test.ts`),
 * with no network, no SignalR, no mocking of a third-party client
 * library's internals. `useCollabDoc.ts` is the thin adapter from a
 * real `HubConnection` to this interface.
 */
export interface CollabRelay {
  publishUpdate(update: Uint8Array): void;
  onUpdate(handler: (update: Uint8Array) => void): () => void;
  requestSync(): void;
  onSyncRequested(handler: (requesterConnectionId: string) => void): () => void;
  sendSyncTo(targetConnectionId: string, update: Uint8Array): void;
  onSync(handler: (update: Uint8Array) => void): () => void;
}

const REMOTE_ORIGIN = "collab-remote";

/**
 * Wires a `Y.Doc` to a `CollabRelay`: broadcasts local edits out via
 * `publishUpdate`, applies relayed remote updates in via `Y.applyUpdate`,
 * and performs the initial join sync (`requestSync`/`onSyncRequested`/
 * `sendSyncTo`) so a newly-connected peer gets caught up from whichever
 * existing peer answers first — see `useCollabDoc.ts`'s own doc comment
 * for why there is no server-persisted copy this phase, and what that
 * implies for the very first person to open a project.
 *
 * Echo-loop prevention: every remote-applied update is tagged with
 * `REMOTE_ORIGIN` via `Y.applyUpdate`'s own transaction-origin
 * parameter; the local `"update"` listener skips re-publishing any
 * update carrying that tag, so a relayed update doesn't bounce back out
 * to the network as if it were a fresh local edit.
 *
 * Returns the cleanup function.
 */
export function wireCollabDocToRelay(doc: Y.Doc, relay: CollabRelay): () => void {
  const onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return;
    relay.publishUpdate(update);
  };
  doc.on("update", onLocalUpdate);

  const unsubUpdate = relay.onUpdate((update) => {
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  });

  const unsubSyncRequested = relay.onSyncRequested((requesterConnectionId) => {
    relay.sendSyncTo(requesterConnectionId, Y.encodeStateAsUpdate(doc));
  });

  const unsubSync = relay.onSync((update) => {
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  });

  relay.requestSync();

  return () => {
    doc.off("update", onLocalUpdate);
    unsubUpdate();
    unsubSyncRequested();
    unsubSync();
  };
}

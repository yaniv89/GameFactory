import { useEffect, useRef } from "react";
import * as Y from "yjs";
import type { HubConnection } from "@microsoft/signalr";
import { createCollabDoc } from "./collabDoc";
import { wireCollabDocToRelay, type CollabRelay } from "./collabSync";
import { useCollabConnection, type CollabConnectionStatus, type UseCollabConnectionOptions } from "./useCollabConnection";

export interface UseCollabDocResult {
  readonly doc: Y.Doc;
  readonly status: CollabConnectionStatus;
}

/**
 * SignalR's default JSON Hub Protocol serializes a C# `byte[]` parameter
 * as a base64 JSON string (System.Text.Json's own convention for byte
 * arrays) — but the JS/TS client does not do the reverse automatically
 * for an *outgoing* `Uint8Array` argument: `JsonHubProtocol.writeMessage`
 * just calls `JSON.stringify` on the whole invocation message, and
 * `JSON.stringify(new Uint8Array(...))` produces `{"0":1,"1":2,...}`,
 * not a base64 string (confirmed directly — not assumed). Caller and
 * callee must agree on the string encoding themselves; base64 both ways
 * is what `CollabHub.cs`'s own `byte[]` parameters expect.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function relayFromConnection(connection: HubConnection): CollabRelay {
  return {
    publishUpdate: (update) => {
      void connection.invoke("PublishUpdate", toBase64(update)).catch(() => {
        // A publish failing (the connection just dropped, most likely)
        // isn't fatal here: the next successful local edit's update
        // carries the accumulated document state forward regardless
        // (Yjs updates aren't strictly incremental deltas that require
        // every prior one to have arrived), and a reconnect re-runs
        // requestSync() to catch up on anything genuinely missed.
      });
    },
    onUpdate: (handler) => {
      const wrapped = (base64: string): void => handler(fromBase64(base64));
      connection.on("yjs:update", wrapped);
      return () => connection.off("yjs:update", wrapped);
    },
    requestSync: () => {
      void connection.invoke("RequestSync").catch(() => {});
    },
    onSyncRequested: (handler) => {
      const wrapped = (requesterConnectionId: string): void => handler(requesterConnectionId);
      connection.on("yjs:syncRequested", wrapped);
      return () => connection.off("yjs:syncRequested", wrapped);
    },
    sendSyncTo: (targetConnectionId, update) => {
      void connection.invoke("SendSyncTo", targetConnectionId, toBase64(update)).catch(() => {});
    },
    onSync: (handler) => {
      const wrapped = (base64: string): void => handler(fromBase64(base64));
      connection.on("yjs:sync", wrapped);
      return () => connection.off("yjs:sync", wrapped);
    },
  };
}

/**
 * Wires a Yjs `Y.Doc` (see `collabDoc.ts` for the document shape and
 * why tile layers are `Y.Map`-keyed rather than `Y.Array`) to
 * `CollabHub`'s M7 Phase 2 relay methods, over the exact same
 * connection `usePresence` uses (`useCollabConnection`) — never a
 * second connection, per that hook's own doc comment on why that would
 * double-count presence.
 *
 * The `Y.Doc` instance is stable for the lifetime of this hook (created
 * once via a ref, not recreated on every render or reconnect) — a
 * reconnect re-wires the same document to the new connection and
 * re-requests a sync, it does not throw away accumulated local state.
 */
export function useCollabDoc(options: UseCollabConnectionOptions): UseCollabDocResult {
  const { status, connection } = useCollabConnection(options);
  const docRef = useRef<Y.Doc>();
  docRef.current ??= createCollabDoc();
  const doc = docRef.current;

  useEffect(() => {
    if (!connection) return undefined;
    return wireCollabDocToRelay(doc, relayFromConnection(connection));
  }, [connection, doc]);

  return { doc, status };
}

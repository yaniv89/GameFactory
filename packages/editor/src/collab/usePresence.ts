import { useEffect, useState } from "react";
import { useCollabConnection, type UseCollabConnectionOptions } from "./useCollabConnection";

/** Wire shape of `services/Forge.Infrastructure/Realtime/IPresenceStore.cs`'s `PresenceEntry` — SignalR's default JSON hub protocol serializes it camelCase. */
export interface PresenceEntry {
  readonly connectionId: string;
  readonly userId: string;
  readonly displayName: string;
}

export type PresenceStatus =
  | "loading" // connecting or reconnecting, or connected but the initial roster hasn't arrived yet
  | "populated" // connected and the roster has arrived; roster always includes the caller, so this is the only reachable "has data" state
  | "error" // connection failed, or the server aborted it — see the doc comment below for why these are indistinguishable here
  | "offline"; // the browser itself has no network (navigator.onLine / the online/offline events) — the one case genuinely distinguishable from "error"

export interface UsePresenceResult {
  readonly status: PresenceStatus;
  readonly roster: readonly PresenceEntry[];
}

export type UsePresenceOptions = UseCollabConnectionOptions;

/**
 * Tracks who else is connected to `options.projectId`'s collaboration
 * session — the "○○○ (3 online)" toolbar indicator, docs/SPEC.md
 * Section 12.2. Presence itself is `CollabHub`'s M7 Phase 1 feature;
 * this hook now layers on top of `useCollabConnection` (extracted in M7
 * Phase 2 so `useCollabDoc`'s Yjs relay can share the exact same
 * connection rather than opening a second one).
 *
 * Of CLAUDE.md Section 5.4's six required UI states, two are not
 * independently reachable by this hub's own design, documented here
 * rather than silently claimed:
 * - **empty**: `presence:roster` always includes the caller once
 *   connected, so "connected with zero entries" cannot occur.
 * - **permission-denied**: `CollabHub.OnConnectedAsync` aborts an
 *   unauthorized connection exactly the same way it aborts an invalid
 *   `projectId` (that file's own doc comment: docs/SPEC.md Section 4.5's
 *   cross-tenant-404 parity applied to a protocol with no status codes),
 *   so the client cannot tell "you don't have access" apart from "the
 *   network dropped" or "that project doesn't exist." Both collapse into
 *   `"error"`.
 */
export function usePresence(options: UsePresenceOptions): UsePresenceResult {
  const { status: connectionStatus, connection } = useCollabConnection(options);
  const [roster, setRoster] = useState<readonly PresenceEntry[]>([]);
  const [hasRoster, setHasRoster] = useState(false);

  useEffect(() => {
    setRoster([]);
    setHasRoster(false);
    if (!connection) return;

    const onRoster = (nextRoster: readonly PresenceEntry[]): void => {
      setRoster(nextRoster);
      setHasRoster(true);
    };
    const onJoined = (entry: PresenceEntry): void => {
      setRoster((current) => (current.some((e) => e.connectionId === entry.connectionId) ? current : [...current, entry]));
    };
    const onLeft = (connectionId: string): void => {
      setRoster((current) => current.filter((e) => e.connectionId !== connectionId));
    };

    connection.on("presence:roster", onRoster);
    connection.on("presence:joined", onJoined);
    connection.on("presence:left", onLeft);

    return () => {
      connection.off("presence:roster", onRoster);
      connection.off("presence:joined", onJoined);
      connection.off("presence:left", onLeft);
    };
  }, [connection]);

  const status: PresenceStatus = connectionStatus === "connected" ? (hasRoster ? "populated" : "loading") : connectionStatus;

  return { status, roster };
}

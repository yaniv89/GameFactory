import {
  HttpTransportType,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import { useEffect, useState } from "react";

/** Wire shape of `services/Forge.Infrastructure/Realtime/IPresenceStore.cs`'s `PresenceEntry` — SignalR's default JSON hub protocol serializes it camelCase. */
export interface PresenceEntry {
  readonly connectionId: string;
  readonly userId: string;
  readonly displayName: string;
}

export type PresenceStatus =
  | "loading" // connecting or reconnecting
  | "populated" // connected; roster always includes the caller, so this is the only reachable "has data" state
  | "error" // connection failed, or the server aborted it — see the doc comment below for why these are indistinguishable here
  | "offline"; // the browser itself has no network (navigator.onLine / the online/offline events) — the one case genuinely distinguishable from "error"

export interface UsePresenceResult {
  readonly status: PresenceStatus;
  readonly roster: readonly PresenceEntry[];
}

export interface UsePresenceOptions {
  /** Origin the API/hub is served from, e.g. `https://api.forge.dev` — no trailing slash. */
  readonly hubUrl: string;
  readonly projectId: string;
  /** In-memory only, never persisted — CLAUDE.md Section 4.7. The caller owns refresh; this hook only reads the current value at connect/reconnect time via `accessTokenFactory`. */
  readonly accessToken: string;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Connects to CollabHub (`services/Forge.Api/Features/Collab/CollabHub.cs`)
 * for `options.projectId` and tracks who else is connected — the
 * "○○○ (3 online)" toolbar indicator, docs/SPEC.md Section 12.2. M7
 * Phase 2's Yjs CRDT relay shares this same connection rather than
 * opening a second one, so this hook (not a one-off component) is where
 * that will attach.
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
  const [status, setStatus] = useState<PresenceStatus>(() => (isOffline() ? "offline" : "loading"));
  const [roster, setRoster] = useState<readonly PresenceEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus(isOffline() ? "offline" : "loading");
    setRoster([]);

    const connection: HubConnection = new HubConnectionBuilder()
      .withUrl(`${options.hubUrl}/hubs/collab?projectId=${encodeURIComponent(options.projectId)}`, {
        accessTokenFactory: () => options.accessToken,
        transport: HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("presence:roster", (nextRoster: readonly PresenceEntry[]) => {
      if (cancelled) return;
      setRoster(nextRoster);
      setStatus("populated");
    });
    connection.on("presence:joined", (entry: PresenceEntry) => {
      if (cancelled) return;
      setRoster((current) => (current.some((e) => e.connectionId === entry.connectionId) ? current : [...current, entry]));
    });
    connection.on("presence:left", (connectionId: string) => {
      if (cancelled) return;
      setRoster((current) => current.filter((e) => e.connectionId !== connectionId));
    });

    connection.onreconnecting(() => {
      if (!cancelled) setStatus(isOffline() ? "offline" : "loading");
    });
    connection.onreconnected(() => {
      if (!cancelled) setStatus("populated");
    });
    connection.onclose(() => {
      if (!cancelled) setStatus(isOffline() ? "offline" : "error");
    });

    const handleOffline = (): void => {
      if (!cancelled) setStatus("offline");
    };
    const handleOnline = (): void => {
      if (!cancelled && connection.state !== HubConnectionState.Connected) setStatus("loading");
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    connection.start().catch(() => {
      if (!cancelled) setStatus(isOffline() ? "offline" : "error");
    });

    return () => {
      cancelled = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      void connection.stop();
    };
  }, [options.hubUrl, options.projectId, options.accessToken]);

  return { status, roster };
}

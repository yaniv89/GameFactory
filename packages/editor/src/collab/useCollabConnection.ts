import {
  HttpTransportType,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import { useEffect, useState } from "react";

export type CollabConnectionStatus = "loading" | "connected" | "error" | "offline";

export interface UseCollabConnectionOptions {
  /** Origin the API/hub is served from, e.g. `https://api.forge.dev` — no trailing slash. */
  readonly hubUrl: string;
  readonly projectId: string;
  /** In-memory only, never persisted — CLAUDE.md Section 4.7. The caller owns refresh; this hook only reads the current value at connect/reconnect time via `accessTokenFactory`. */
  readonly accessToken: string;
}

export interface UseCollabConnectionResult {
  readonly status: CollabConnectionStatus;
  /** Non-null only while actually connected — every consumer registers its own `.on(...)` handlers against this same instance and must re-run when it changes (a new instance means a new connection). */
  readonly connection: HubConnection | null;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Owns the single `HubConnection` to `CollabHub` (`services/Forge.Api/Features/Collab/CollabHub.cs`)
 * for a project — one per browser tab, shared by every collaboration
 * feature (`usePresence`, `useCollabDoc`), not one connection each.
 * That matters for real, visible correctness: CollabHub tracks presence
 * per *connection*, so two independent connections from the same tab
 * would double-count that tab in the "N online" indicator.
 *
 * Extracted from M7 Phase 1's `usePresence` (which used to own this
 * lifecycle directly) when Phase 2 needed a second consumer of the same
 * connection — see that hook's own doc comment, which already named
 * this as the intended shape.
 */
export function useCollabConnection(options: UseCollabConnectionOptions): UseCollabConnectionResult {
  const [status, setStatus] = useState<CollabConnectionStatus>(() => (isOffline() ? "offline" : "loading"));
  const [connection, setConnection] = useState<HubConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(isOffline() ? "offline" : "loading");
    setConnection(null);

    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl(`${options.hubUrl}/hubs/collab?projectId=${encodeURIComponent(options.projectId)}`, {
        accessTokenFactory: () => options.accessToken,
        transport: HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    conn.onreconnecting(() => {
      if (!cancelled) {
        setStatus(isOffline() ? "offline" : "loading");
        setConnection(null);
      }
    });
    conn.onreconnected(() => {
      if (!cancelled) {
        setStatus("connected");
        setConnection(conn);
      }
    });
    conn.onclose(() => {
      if (!cancelled) {
        setStatus(isOffline() ? "offline" : "error");
        setConnection(null);
      }
    });

    const handleOffline = (): void => {
      if (!cancelled) setStatus("offline");
    };
    const handleOnline = (): void => {
      if (!cancelled && conn.state !== HubConnectionState.Connected) setStatus("loading");
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    conn
      .start()
      .then(() => {
        if (!cancelled) {
          setStatus("connected");
          setConnection(conn);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus(isOffline() ? "offline" : "error");
      });

    return () => {
      cancelled = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      setConnection(null);
      void conn.stop();
    };
  }, [options.hubUrl, options.projectId, options.accessToken]);

  return { status, connection };
}

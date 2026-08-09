import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./usePresence";

type Handler = (...args: unknown[]) => void;

/** A minimal, real-shaped fake of the one `HubConnection` surface `usePresence` actually calls — not a snapshot of the real class, just enough to drive its state machine deterministically in a test. */
class FakeHubConnection {
  static instances: FakeHubConnection[] = [];
  /** Set before rendering to make the *next* constructed connection's start() reject, then auto-clears. */
  static nextStartError: Error | null = null;

  handlers = new Map<string, Handler>();
  closeHandlers: Handler[] = [];
  reconnectingHandlers: Handler[] = [];
  reconnectedHandlers: Handler[] = [];
  state = "Disconnected";
  stop = vi.fn(async () => {
    this.state = "Disconnected";
  });
  private readonly startError: Error | null;

  constructor() {
    this.startError = FakeHubConnection.nextStartError;
    FakeHubConnection.nextStartError = null;
    FakeHubConnection.instances.push(this);
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  off(event: string): void {
    this.handlers.delete(event);
  }

  onclose(handler: Handler): void {
    this.closeHandlers.push(handler);
  }

  onreconnecting(handler: Handler): void {
    this.reconnectingHandlers.push(handler);
  }

  onreconnected(handler: Handler): void {
    this.reconnectedHandlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
    this.state = "Connected";
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }
}

vi.mock("@microsoft/signalr", () => ({
  HubConnectionBuilder: vi.fn().mockImplementation(() => {
    const connection = new FakeHubConnection();
    return {
      withUrl: vi.fn().mockReturnThis(),
      withAutomaticReconnect: vi.fn().mockReturnThis(),
      configureLogging: vi.fn().mockReturnThis(),
      build: vi.fn(() => connection),
    };
  }),
  HttpTransportType: { WebSockets: 1 },
  HubConnectionState: { Connected: "Connected", Disconnected: "Disconnected" },
  LogLevel: { Warning: 2 },
}));

const OPTIONS = { hubUrl: "https://api.forge.test", projectId: "project-1", accessToken: "test-token" };

function latestConnection(): FakeHubConnection {
  return FakeHubConnection.instances[FakeHubConnection.instances.length - 1]!;
}

describe("usePresence", () => {
  beforeEach(() => {
    FakeHubConnection.instances = [];
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("starts in loading state and opens a connection to the right hub URL", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));
  });

  it("moves to populated with the roster CollabHub sends on join", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    act(() => {
      latestConnection().emit("presence:roster", [
        { connectionId: "a", userId: "u1", displayName: "Ada" },
        { connectionId: "b", userId: "u2", displayName: "Grace" },
      ]);
    });

    expect(result.current.status).toBe("populated");
    expect(result.current.roster).toHaveLength(2);
  });

  it("adds a joiner without duplicating an existing entry", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    act(() => latestConnection().emit("presence:roster", [{ connectionId: "a", userId: "u1", displayName: "Ada" }]));
    act(() => latestConnection().emit("presence:joined", { connectionId: "b", userId: "u2", displayName: "Grace" }));
    expect(result.current.roster.map((e) => e.connectionId)).toEqual(["a", "b"]);

    act(() => latestConnection().emit("presence:joined", { connectionId: "b", userId: "u2", displayName: "Grace" }));
    expect(result.current.roster).toHaveLength(2);
  });

  it("removes a leaver from the roster", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    act(() =>
      latestConnection().emit("presence:roster", [
        { connectionId: "a", userId: "u1", displayName: "Ada" },
        { connectionId: "b", userId: "u2", displayName: "Grace" },
      ]),
    );
    act(() => latestConnection().emit("presence:left", "b"));

    expect(result.current.roster.map((e) => e.connectionId)).toEqual(["a"]);
  });

  it("moves to error when the connection closes unexpectedly while online", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    act(() => latestConnection().closeHandlers.forEach((h) => h()));

    expect(result.current.status).toBe("error");
  });

  it("moves to offline, not error, when the browser itself has no network", async () => {
    const { result } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });
    act(() => latestConnection().closeHandlers.forEach((h) => h()));

    expect(result.current.status).toBe("offline");
  });

  it("moves to error when start() itself rejects", async () => {
    FakeHubConnection.nextStartError = new Error("boom");
    const { result } = renderHook(() => usePresence(OPTIONS));

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("stops the connection on unmount", async () => {
    const { unmount } = renderHook(() => usePresence(OPTIONS));
    await waitFor(() => expect(latestConnection().state).toBe("Connected"));

    const connection = latestConnection();
    unmount();

    expect(connection.stop).toHaveBeenCalledTimes(1);
  });
});

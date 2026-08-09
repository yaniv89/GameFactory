import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paintTile, readTileLayer, seedTileLayer } from "./collabDoc";
import { useCollabDoc } from "./useCollabDoc";

type Handler = (...args: unknown[]) => void;

/**
 * A fake `HubConnection` PLUS a fake server relay in one: `.invoke(method, ...args)`
 * reproduces exactly what `CollabHub.cs`'s corresponding method does —
 * `PublishUpdate`/`RequestSync` broadcast to every other connected
 * fake, `SendSyncTo` delivers to one named target — so this test
 * exercises `useCollabDoc`'s real base64 encode/decode adapter layer
 * (the one thing `collabSync.test.ts`'s pure in-memory bus doesn't
 * touch, since that test hands `Uint8Array`s directly) end to end,
 * without a real network or a real .NET host.
 */
class FakeHubConnection {
  static registry = new Map<string, FakeHubConnection>();

  readonly connectionId: string;
  handlers = new Map<string, Handler>();
  state = "Disconnected";

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  off(event: string): void {
    this.handlers.delete(event);
  }

  onclose(): void {}
  onreconnecting(): void {}
  onreconnected(): void {}

  async start(): Promise<void> {
    this.state = "Connected";
    FakeHubConnection.registry.set(this.connectionId, this);
  }

  async stop(): Promise<void> {
    this.state = "Disconnected";
    FakeHubConnection.registry.delete(this.connectionId);
  }

  async invoke(method: string, ...args: unknown[]): Promise<void> {
    const others = (): FakeHubConnection[] => [...FakeHubConnection.registry.values()].filter((c) => c !== this);
    if (method === "PublishUpdate") {
      const [update] = args;
      others().forEach((peer) => peer.handlers.get("yjs:update")?.(update));
    } else if (method === "RequestSync") {
      others().forEach((peer) => peer.handlers.get("yjs:syncRequested")?.(this.connectionId));
    } else if (method === "SendSyncTo") {
      const [targetConnectionId, update] = args;
      FakeHubConnection.registry.get(targetConnectionId as string)?.handlers.get("yjs:sync")?.(update);
    }
  }
}

let nextConnectionId = 0;

vi.mock("@microsoft/signalr", () => ({
  HubConnectionBuilder: vi.fn().mockImplementation(() => {
    const connection = new FakeHubConnection(`conn-${nextConnectionId++}`);
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

describe("useCollabDoc", () => {
  beforeEach(() => {
    FakeHubConnection.registry.clear();
    nextConnectionId = 0;
  });

  it("reaches connected status once the underlying connection starts", async () => {
    const { result } = renderHook(() => useCollabDoc(OPTIONS));
    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("a second peer's edits reach the first, through real base64-encoded wire messages", async () => {
    const peerA = renderHook(() => useCollabDoc(OPTIONS));
    await waitFor(() => expect(peerA.result.current.status).toBe("connected"));
    seedTileLayer(peerA.result.current.doc, "scene-1", new Array(9).fill(1));

    const peerB = renderHook(() => useCollabDoc(OPTIONS));
    await waitFor(() => expect(peerB.result.current.status).toBe("connected"));

    // Peer B should have received A's seeded state via the join sync.
    await waitFor(() => expect(readTileLayer(peerB.result.current.doc, "scene-1", 9, 0)).toEqual(new Array(9).fill(1)));

    paintTile(peerB.result.current.doc, "scene-1", 3, 7);

    await waitFor(() => expect(readTileLayer(peerA.result.current.doc, "scene-1", 9, 0)[3]).toBe(7));
  });
});

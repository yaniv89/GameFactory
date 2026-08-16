import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/authClient", () => ({
  ensureFreshAccessToken: vi.fn().mockResolvedValue("live-token"),
}));

import { ensureFreshAccessToken } from "../auth/authClient";
import { ApiError, NetworkError, httpJson } from "./httpClient";

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } });
}

describe("httpJson", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(ensureFreshAccessToken).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches a live Bearer token to authenticated requests", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await httpJson("/api/v1/me");
    expect(ensureFreshAccessToken).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer live-token");
  });

  it("skips the token for authenticated: false requests", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await httpJson("/api/v1/auth/signup", { authenticated: false, method: "POST", body: { a: 1 } });
    expect(ensureFreshAccessToken).not.toHaveBeenCalled();
  });

  it("JSON-encodes the body and sets Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await httpJson("/api/v1/x", { method: "POST", body: { title: "Starter" } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ title: "Starter" }));
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for a 204 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(httpJson("/api/v1/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("throws ApiError with the server's detail and status on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Slug already in use." }, { status: 409 }));
    const error = await httpJson("/api/v1/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe("Slug already in use.");
  });

  it("falls back to the first validation error when there's no top-level detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: { slug: ["Must be lowercase."] } }, { status: 400 }));
    const error = (await httpJson("/api/v1/x").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Must be lowercase.");
  });

  it("throws NetworkError when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(httpJson("/api/v1/x")).rejects.toBeInstanceOf(NetworkError);
  });
});

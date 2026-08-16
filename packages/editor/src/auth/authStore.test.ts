import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } });
}

async function freshAuthStore() {
  vi.resetModules();
  const { useAuthStore } = await import("./authStore");
  return useAuthStore;
}

describe("useAuthStore", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts signedOut with no session or error", async () => {
    const useAuthStore = await freshAuthStore();
    const state = useAuthStore.getState();
    expect(state.status).toBe("signedOut");
    expect(state.session).toBeUndefined();
    expect(state.error).toBeUndefined();
  });

  it("login() moves to signingIn immediately, then to error with the server's message on failure", async () => {
    const useAuthStore = await freshAuthStore();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid email or password." }, { status: 401 }));

    const loginPromise = useAuthStore.getState().login("ada@example.com", "wrong");
    expect(useAuthStore.getState().status).toBe("signingIn");
    await loginPromise;

    expect(useAuthStore.getState().status).toBe("error");
    expect(useAuthStore.getState().error).toBe("Invalid email or password.");
  });

  it("clearError() resets the error without changing status", async () => {
    const useAuthStore = await freshAuthStore();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "nope" }, { status: 401 }));
    await useAuthStore.getState().login("ada@example.com", "wrong");
    expect(useAuthStore.getState().error).toBe("nope");

    useAuthStore.getState().clearError();

    expect(useAuthStore.getState().error).toBeUndefined();
    expect(useAuthStore.getState().status).toBe("error");
  });

  it("signup() calls signup then login, surfacing a signup failure as an error without ever calling login", async () => {
    const useAuthStore = await freshAuthStore();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Email already registered." }, { status: 409 }));

    await useAuthStore.getState().signup("ada@example.com", "password12345", "Ada");

    expect(useAuthStore.getState().status).toBe("error");
    expect(useAuthStore.getState().error).toBe("Email already registered.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/signup", expect.anything());
  });

  it("logout() returns to signedOut and clears the session", async () => {
    const useAuthStore = await freshAuthStore();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); // /connect/logout

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(useAuthStore.getState().session).toBeUndefined();
  });
});

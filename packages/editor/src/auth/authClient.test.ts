import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * authClient.ts holds its session in module-level state (deliberately —
 * see its own doc comment on why: no localStorage/sessionStorage for
 * tokens). Every test here re-imports the module fresh via
 * `vi.resetModules()` so one test's session can't leak into the next,
 * the same isolation a real page reload would give it in the browser.
 *
 * `login()`'s real `window.location.assign(...)` call is never mocked
 * or asserted on directly — jsdom treats even an attempted reassignment
 * or spy of `window.location` as a real (unimplemented) navigation, not
 * something interceptable (confirmed directly, not assumed: both
 * `vi.spyOn(window.location, "assign")` and `Location.prototype.assign`
 * fail in this environment). `buildAuthorizeUrl` was split out of
 * `login()` specifically so the actual security-relevant part — what
 * URL gets built — is covered without needing to intercept navigation
 * at all; `login()`'s own tests below just tolerate the harmless
 * "Not implemented: navigation" console noise jsdom prints when the
 * unmocked `.assign()` call actually runs.
 */
async function freshAuthClient() {
  vi.resetModules();
  return import("./authClient");
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } });
}

describe("authClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("buildAuthorizeUrl", () => {
    it("builds a /connect/authorize URL with the fixed client/scope/redirect params plus the given challenge and state", async () => {
      const { buildAuthorizeUrl } = await freshAuthClient();
      const url = buildAuthorizeUrl("the-challenge", "the-state");

      expect(url.pathname).toBe("/connect/authorize");
      expect(url.searchParams.get("client_id")).toBe("forge-editor");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
      expect(url.searchParams.get("state")).toBe("the-state");
      expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/auth/callback`);
      expect(url.searchParams.get("scope")).toContain("offline_access");
    });
  });

  it("login() posts credentials to /api/v1/auth/login and stashes a fresh verifier/state pair for the callback to consume", async () => {
    const { login } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await login("ada@example.com", "correct horse battery staple");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", password: "correct horse battery staple" }),
      }),
    );
    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { verifier: string; state: string };
    expect(pending.verifier).toBeTruthy();
    expect(pending.state).toBeTruthy();
  });

  it("login() throws the server's error detail and never reaches the PKCE/redirect step when the credentials are rejected", async () => {
    const { login } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid email or password." }, { status: 401 }));

    await expect(login("ada@example.com", "wrong")).rejects.toThrow("Invalid email or password.");
    expect(sessionStorage.getItem("forge_pkce_pending")).toBeNull();
  });

  it("completeLoginFromCallback rejects when no sign-in was pending in this tab (nothing in sessionStorage)", async () => {
    const { completeLoginFromCallback } = await freshAuthClient();
    await expect(
      completeLoginFromCallback(new URL("http://localhost/auth/callback?code=abc&state=xyz")),
    ).rejects.toThrow(/no sign-in was in progress/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completeLoginFromCallback rejects a state that doesn't match what login() stored (CSRF check) without ever calling /connect/token", async () => {
    const { login, completeLoginFromCallback } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await login("ada@example.com", "password12345");
    fetchMock.mockClear();

    await expect(
      completeLoginFromCallback(new URL("http://localhost/auth/callback?code=abc&state=not-the-real-state")),
    ).rejects.toThrow(/state.*did not match/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completeLoginFromCallback surfaces an authorization-server error from the callback query string", async () => {
    const { completeLoginFromCallback } = await freshAuthClient();
    await expect(
      completeLoginFromCallback(new URL("http://localhost/auth/callback?error=access_denied&error_description=User+cancelled")),
    ).rejects.toThrow("User cancelled");
  });

  it("login() -> completeLoginFromCallback() exchanges the code with the exact verifier login() generated, and applies the returned session", async () => {
    const { login, completeLoginFromCallback, getSession } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); // /api/v1/auth/login
    await login("ada@example.com", "password12345");

    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { verifier: string; state: string };

    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: 900 })); // /connect/token — refresh token is set as an httpOnly cookie, never in this body
    const session = await completeLoginFromCallback(
      new URL(`http://localhost/auth/callback?code=real-code&state=${pending.state}`),
    );

    expect(session.accessToken).toBe("at-1");
    expect(getSession()).toEqual(session);

    const tokenCall = fetchMock.mock.calls.find(([url]) => url === "/connect/token")!;
    const body = tokenCall[1]!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("real-code");
    expect(body.get("code_verifier")).toBe(pending.verifier);
    expect(body.get("client_id")).toBe("forge-editor");

    // The one-time PKCE entry must not be reusable.
    expect(sessionStorage.getItem("forge_pkce_pending")).toBeNull();
  });

  it("ensureFreshAccessToken returns the current token without a network call when it isn't near expiry", async () => {
    const { login, completeLoginFromCallback, ensureFreshAccessToken } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await login("ada@example.com", "password12345");
    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { state: string };
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: 900 }));
    await completeLoginFromCallback(new URL(`http://localhost/auth/callback?code=c&state=${pending.state}`));
    fetchMock.mockClear();

    const token = await ensureFreshAccessToken();

    expect(token).toBe("at-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ensureFreshAccessToken refreshes when the access token is expired, relying on the httpOnly refresh cookie rather than any held token", async () => {
    const { login, completeLoginFromCallback, ensureFreshAccessToken } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await login("ada@example.com", "password12345");
    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { state: string };
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: -1 })); // already expired
    await completeLoginFromCallback(new URL(`http://localhost/auth/callback?code=c&state=${pending.state}`));
    fetchMock.mockClear();

    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-2", expires_in: 900 }));
    const token = await ensureFreshAccessToken();

    expect(token).toBe("at-2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/connect/token");
    const body = init!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    // No refresh_token field: the browser attaches the httpOnly forge_rt
    // cookie to this same-origin request automatically. Client JS never
    // holds the value, so there is nothing here to assert it sent.
    expect(body.has("refresh_token")).toBe(false);
  });

  it("ensureFreshAccessToken refreshes via the cookie on first call with no prior session (e.g. after a page reload)", async () => {
    const { ensureFreshAccessToken } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-restored", expires_in: 900 }));

    const token = await ensureFreshAccessToken();

    expect(token).toBe("at-restored");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/connect/token");
    const body = init!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("refreshAccessToken clears the session and throws when there is no valid refresh cookie", async () => {
    const { login, completeLoginFromCallback, refreshAccessToken, getSession } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await login("ada@example.com", "password12345");
    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { state: string };
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: 900 }));
    await completeLoginFromCallback(new URL(`http://localhost/auth/callback?code=c&state=${pending.state}`));

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "The token is no longer valid." }, { status: 400 }));
    await expect(refreshAccessToken()).rejects.toThrow("The token is no longer valid.");
    expect(getSession()).toBeUndefined();
  });

  it("logout() clears the session immediately and posts to /connect/logout with no body — the httpOnly cookie is what gets revoked server-side", async () => {
    const { login, completeLoginFromCallback, logout, getSession } = await freshAuthClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await login("ada@example.com", "password12345");
    const pending = JSON.parse(sessionStorage.getItem("forge_pkce_pending")!) as { state: string };
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: 900 }));
    await completeLoginFromCallback(new URL(`http://localhost/auth/callback?code=c&state=${pending.state}`));
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await logout();

    expect(getSession()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/connect/logout", expect.objectContaining({ method: "POST" }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).not.toHaveProperty("body");
  });
});

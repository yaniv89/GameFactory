import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";

/**
 * OAuth 2.0 Authorization Code + PKCE client for Forge.Api's OpenIddict
 * server (services/Forge.Api/Features/Auth/, OpenIddictSeeding.cs). All
 * requests are relative — vite.config.ts's dev-server proxy (or, in a
 * real deployment, the same reverse-proxy origin docs/SPEC.md's origin
 * separation assumes) makes the browser see the editor and the API as
 * one origin, so the Identity login cookie's `SameSite=Strict`
 * (Forge.Infrastructure/DependencyInjection.cs) still works — a real
 * cross-origin CORS setup would break that cookie regardless of
 * `credentials: "include"`.
 *
 * Token storage: the access token lives in a module-level variable only —
 * never `localStorage`, never `sessionStorage` (CLAUDE.md Section 12 item
 * 2: "the answer is a refresh cookie and a broadcast channel"). The
 * refresh token never reaches this file at all: `/connect/token` sets it
 * as an httpOnly, `SameSite=Strict` cookie scoped to `/connect`
 * (Forge.Infrastructure/DependencyInjection.cs's `ProcessSignInContext`
 * handler + RefreshTokenCookie.cs) instead of returning it in the JSON
 * body, so no JS on this origin — first-party or an XSS payload in a
 * third-party module's sandbox escape — can ever read it. The browser
 * attaches the cookie automatically on every same-origin fetch to
 * `/connect/*` (fetch's default `credentials: "same-origin"` already
 * covers this; no explicit `credentials` option needed here), which is
 * also what makes a page reload able to silently refresh instead of
 * forcing a full sign-in again, via `refreshAccessToken()`. The
 * `BroadcastChannel` half is built too: a token refreshed or cleared in
 * one tab is reflected in every other open tab immediately.
 */

const CLIENT_ID = "forge-editor";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const SCOPE = "openid email profile offline_access forge_api";
const PKCE_STORAGE_KEY = "forge_pkce_pending"; // sessionStorage — PKCE bookkeeping (a verifier/state pair), not a credential; must survive the /connect/authorize redirect within the same tab.

export interface Session {
  readonly accessToken: string;
  readonly expiresAt: number; // epoch ms
}

interface PendingPkce {
  readonly verifier: string;
  readonly state: string;
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

let currentSession: Session | undefined;

const channel = "BroadcastChannel" in window ? new BroadcastChannel("forge-auth") : undefined;
type BroadcastMessage = { readonly type: "session"; readonly session: Session | undefined };
const listeners = new Set<(session: Session | undefined) => void>();

channel?.addEventListener("message", (event: MessageEvent<BroadcastMessage>) => {
  if (event.data.type !== "session") return;
  currentSession = event.data.session;
  for (const listener of listeners) listener(currentSession);
});

function setSession(session: Session | undefined): void {
  currentSession = session;
  channel?.postMessage({ type: "session", session } satisfies BroadcastMessage);
  for (const listener of listeners) listener(session);
}

/** Subscribes to session changes, including ones that happened in a different tab. Returns an unsubscribe function. */
export function onSessionChange(listener: (session: Session | undefined) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession(): Session | undefined {
  return currentSession;
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; error_description?: string; title?: string };
    return body.detail ?? body.error_description ?? body.title ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function applyTokenResponse(payload: TokenResponse): Session {
  const session: Session = { accessToken: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  setSession(session);
  return session;
}

/**
 * `POST /api/v1/auth/signup` — creates the account and its default
 * workspace. Does not itself sign the user in; call `login` after (or
 * have the caller do it once email verification is handled, per
 * docs/SPEC.md Section 23's flow).
 */
export async function signup(email: string, password: string, displayName: string): Promise<void> {
  const response = await fetch("/api/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!response.ok) throw new Error(await parseErrorDetail(response));
}

/**
 * Pure URL construction, split out from `login()` specifically so it's
 * directly unit-testable: `window.location.assign` (a real browser
 * navigation) can't be meaningfully intercepted in a jsdom test
 * environment — reassigning or spying on `window.location` is either a
 * no-op or an outright "Cannot redefine property" there, since jsdom
 * treats even an *attempted* reassignment as a real navigation attempt.
 * Keeping the URL-building logic — the actual security-relevant part —
 * separate from the one line that calls `.assign()` sidesteps that
 * entirely rather than fighting it.
 */
export function buildAuthorizeUrl(challenge: string, state: string): URL {
  const authorizeUrl = new URL("/connect/authorize", window.location.origin);
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", SCOPE);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl;
}

/**
 * `POST /api/v1/auth/login` establishes the Identity application cookie
 * `/connect/authorize` requires (AuthorizationEndpoint.cs's own doc
 * comment), then this drives the full Authorization Code + PKCE exchange
 * against the real OpenIddict server — a real browser redirect via
 * `/connect/authorize`, not a same-tab fetch, since that endpoint's
 * success path is a 302 a fetch call can't usefully follow (it needs the
 * browser's own cookie jar and navigation). The redirect lands back on
 * `/auth/callback`, which calls `completeLoginFromCallback` below to
 * finish the exchange.
 */
export async function login(email: string, password: string): Promise<void> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await parseErrorDetail(response));

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify({ verifier, state } satisfies PendingPkce));

  const authorizeUrl = buildAuthorizeUrl(challenge, state);
  window.location.assign(authorizeUrl.toString());
}

/**
 * Called from the `/auth/callback` route once the browser lands back
 * with `?code=...&state=...` in the URL. Verifies `state` against what
 * `login()` stored (anti-CSRF — a callback URL without a matching
 * pending PKCE entry is rejected, not silently accepted), then exchanges
 * the code for tokens.
 */
export async function completeLoginFromCallback(callbackUrl: URL): Promise<Session> {
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
  }

  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  if (!code || !state) throw new Error("Sign-in callback is missing 'code' or 'state'.");

  const pendingRaw = sessionStorage.getItem(PKCE_STORAGE_KEY);
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
  if (!pendingRaw) throw new Error("No sign-in was in progress in this tab.");
  const pending = JSON.parse(pendingRaw) as PendingPkce;
  if (pending.state !== state) throw new Error("Sign-in callback 'state' did not match — possible CSRF, request rejected.");

  const response = await fetch("/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pending.verifier,
    }),
  });
  if (!response.ok) throw new Error(await parseErrorDetail(response));

  return applyTokenResponse((await response.json()) as TokenResponse);
}

/**
 * Exchanges the refresh token for a fresh access token. The refresh token
 * itself is never passed here — it's the httpOnly `forge_rt` cookie,
 * attached by the browser automatically since this is a same-origin
 * request. Throws (and clears the session) if there is no valid cookie,
 * which is also the normal "not signed in" case (e.g. first load in a
 * browser with no session), not just an error case.
 */
export async function refreshAccessToken(): Promise<Session> {
  const response = await fetch("/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    setSession(undefined);
    throw new Error(await parseErrorDetail(response));
  }

  return applyTokenResponse((await response.json()) as TokenResponse);
}

/** Revokes the refresh token server-side (LogoutEndpoint.cs, reading the httpOnly cookie) and clears the session in every tab. */
export async function logout(): Promise<void> {
  setSession(undefined);
  await fetch("/connect/logout", { method: "POST" }).catch(() => {
    // Best-effort revocation — the local session is already cleared
    // above regardless of whether this network call succeeds, so a
    // logged-out browser never re-sends the old token either way.
  });
}

/** True once the current access token is within this many ms of expiring — refresh proactively rather than waiting for a 401. */
const REFRESH_SKEW_MS = 30_000;

/**
 * Returns a currently-valid access token, refreshing it first if it's
 * expired or about to be — the single call site every authenticated API
 * request should route through, so token refresh is never duplicated
 * per-endpoint.
 */
export async function ensureFreshAccessToken(): Promise<string> {
  if (currentSession && currentSession.expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return currentSession.accessToken;
  }
  const session = await refreshAccessToken();
  return session.accessToken;
}

import { ensureFreshAccessToken } from "../auth/authClient";

/**
 * The single fetch wrapper every authenticated call to Forge.Api routes
 * through: attaches a live access token (refreshing it first via
 * `ensureFreshAccessToken` when it's expired or about to be — CLAUDE.md
 * Section 4.7, "access tokens in memory only"), and turns a non-2xx
 * response into a thrown `ApiError` carrying the server's own problem-detail
 * fields rather than a generic "request failed" string, so callers can
 * follow the copy rules in Section 5.5 (what happened, why, what to do).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extensions: Record<string, unknown> | undefined,
    /**
     * Seconds from a 429 response's own `Retry-After` header
     * (`RateLimitingMiddleware.cs`'s own `context.Response.Headers.RetryAfter`
     * write) — `undefined` for every other status, or if the header was
     * somehow absent on a 429. CLAUDE.md Section 4.8: "Retry-After
     * surfaced in the UI" — this is the plumbing that makes that
     * possible; the art-generation dialog (N5) is the first caller that
     * actually reads it.
     */
    readonly retryAfterSeconds: number | undefined = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown by `httpFetch`/`httpJson` when the browser has no network path to the API at all — distinct from a server-returned error status. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Could not reach the server. Check your connection and try again.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

async function extractErrorDetail(response: Response): Promise<{ message: string; extensions: Record<string, unknown> | undefined }> {
  try {
    const body = (await response.json()) as { detail?: string; title?: string; errors?: Record<string, string[]> } & Record<string, unknown>;
    const firstFieldError = body.errors ? Object.values(body.errors)[0]?.[0] : undefined;
    const message = body.detail ?? firstFieldError ?? body.title ?? `${response.status} ${response.statusText}`;
    return { message, extensions: body };
  } catch {
    return { message: `${response.status} ${response.statusText}`, extensions: undefined };
  }
}

/** `Retry-After` is always seconds in this codebase (`RateLimitingMiddleware.cs` writes `retryAfterSeconds.ToString()`, never an HTTP-date), so a plain parse is complete — no HTTP-date branch to also handle. */
function extractRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

async function throwApiError(response: Response): Promise<never> {
  const { message, extensions } = await extractErrorDetail(response);
  throw new ApiError(message, response.status, extensions, response.status === 429 ? extractRetryAfterSeconds(response) : undefined);
}

export interface HttpOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Set false for calls that don't require a signed-in session (there are none yet, but the option exists rather than assuming). */
  readonly authenticated?: boolean;
}

/** Authenticated JSON request against Forge.Api. Returns `undefined` for a 204 No Content response. */
export async function httpJson<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const { method = "GET", body, authenticated = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authenticated) headers.Authorization = `Bearer ${await ensureFreshAccessToken()}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (!response.ok) {
    await throwApiError(response);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Authenticated binary fetch — same auth/refresh/error handling as
 * `httpJson`, but for endpoints that return real bytes (an asset's
 * decoded image content, `GetAssetContentEndpoint.cs`) rather than JSON.
 * A plain `<img src>`/PixiJS `Assets.load(url)` can't attach an
 * `Authorization` header, so a caller needing to actually render one of
 * these fetches the bytes through here first and hands the browser an
 * object URL instead (`URL.createObjectURL` on the returned `Blob`) —
 * `packTiles.ts`'s own project-asset wiring is the first real caller.
 */
export async function httpBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Authorization: `Bearer ${await ensureFreshAccessToken()}` } });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (!response.ok) {
    await throwApiError(response);
  }
  return response.blob();
}

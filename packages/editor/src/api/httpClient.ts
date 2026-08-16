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
    const { message, extensions } = await extractErrorDetail(response);
    throw new ApiError(message, response.status, extensions);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

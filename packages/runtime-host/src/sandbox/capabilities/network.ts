import type { CapabilityHandler } from "../capabilities";

export interface NetworkHandlerOptions {
  /** Exact origins (`https://api.example.com`, no path/query) this module's manifest declared. Per docs/SPEC.md Section 10.3: "declared domain allowlist in the manifest... any change... requires re-consent." */
  allowedOrigins: readonly string[];
  /** Injectable for tests; defaults to the real global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * `network` per docs/SPEC.md Section 10.3 — "the dangerous one." The
 * allowlist check happens here, host-side, before the fetch ever
 * happens — this is the first of the two independent layers
 * docs/security/SANDBOX-DESIGN.md Section 4.1 requires (the second is
 * the CSP `connect-src` header on the game frame itself, which is an
 * origin/deployment concern, not something this class can enforce).
 */
export class NetworkHandler implements CapabilityHandler {
  readonly capability = "network" as const;
  readonly globalName = "network";
  readonly asyncMethods = ["fetch"] as const;

  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NetworkHandlerOptions) {
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async callAsync(method: string, args: readonly unknown[]): Promise<unknown> {
    if (method !== "fetch") {
      throw new Error(`network: unknown method "${method}"`);
    }
    const [url] = args as [string];
    if (typeof url !== "string") {
      throw new Error("network.fetch: url must be a string");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`network.fetch: "${url}" is not a valid URL`);
    }

    if (!this.allowedOrigins.has(parsed.origin)) {
      throw new Error(
        `network.fetch: origin "${parsed.origin}" is not in this module's declared allowlist`,
      );
    }

    const response = await this.fetchImpl(url);
    const body = await response.text();
    return { status: response.status, ok: response.ok, body };
  }
}

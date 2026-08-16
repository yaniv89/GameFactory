/**
 * RFC 7636 PKCE code_verifier/code_challenge generation for the editor's
 * OAuth 2.0 Authorization Code flow against Forge.Api's OpenIddict server
 * (services/Forge.Api/OpenIddictSeeding.cs — the "forge-editor" client is
 * a public client with `RequireProofKeyForCodeExchange`, no secret).
 *
 * Built entirely on the browser's own Web Crypto API (`crypto.subtle`,
 * `crypto.getRandomValues`) — no new dependency, consistent with
 * CLAUDE.md Section 2.2's pinned frontend stack, which names no OIDC
 * client library.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url-encoded — well within RFC 7636's 43-128 character verifier length bounds. */
export function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** S256 challenge: base64url(SHA-256(ascii(verifier))). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Opaque anti-CSRF value for the `state` parameter — same generation as the verifier, different purpose. */
export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

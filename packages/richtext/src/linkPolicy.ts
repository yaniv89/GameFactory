/**
 * docs/adr/0011 Decision 4: the link scheme allowlist and the
 * normalization that makes it hold against real evasions.
 *
 * This is the one genuinely dangerous thing a parser that never produces
 * HTML can still emit, because a consumer will eventually put the value
 * on an anchor's `href`. So it is resolved here, once, rather than left
 * to every consumer to remember.
 */

/** Absolute schemes a link may use. Anything else — most importantly `javascript:` and `data:` — is rejected. */
export const ALLOWED_LINK_SCHEMES: readonly string[] = ["https:", "http:", "mailto:"];

/**
 * Every ASCII control character plus space. Browsers strip these while
 * resolving a URL, which is exactly what an attacker relies on to smuggle
 * a blocked scheme past a naive `startsWith("javascript:")` check —
 * `java&#9;script:`, a leading NUL, an embedded newline. Stripping them
 * before comparing means the string we validate is the string the browser
 * will effectively see.
 */
const STRIPPED_CHARACTERS = /[\u0000-\u0020\u007F]/g;

/**
 * Returns the sanitized href if it is safe to render as a link, or
 * `undefined` if it must not be.
 *
 * The returned value is the *stripped* form, not the caller's raw input,
 * so that what gets stored in the AST is byte-for-byte what was
 * validated — there is no gap between "the string I checked" and "the
 * string I emit" for an evasion to live in. A legitimate URL containing a
 * literal space loses it, which is correct: such a URL should be
 * percent-encoded, and browsers strip it anyway.
 *
 * A URL with no scheme at all (`/path`, `//host`, `#fragment`) is
 * rejected rather than treated as relative — a published game is served
 * from a content-addressed build path where relative links are
 * meaningless, so allowing them would widen what has to be reasoned about
 * for no benefit.
 */
export function sanitizeLinkHref(rawHref: string): string | undefined {
  const stripped = rawHref.replace(STRIPPED_CHARACTERS, "");
  const lowered = stripped.toLowerCase();
  return ALLOWED_LINK_SCHEMES.some((scheme) => lowered.startsWith(scheme)) ? stripped : undefined;
}

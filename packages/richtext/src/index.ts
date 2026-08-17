/**
 * `@forge/richtext` — the sanitizing rich text AST parser CLAUDE.md
 * Section 1.1 guardrail 3 and `docs/security/THREAT-MODEL.md` T7 (stored
 * XSS, CWE-79) both point at. See `docs/adr/0011` for the markup subset,
 * the link policy, and why this package has no HTML-string output at all.
 *
 * The contract in one line: **text goes in, a typed AST comes out, and no
 * function here ever returns a string of markup.** Consumers walk the AST
 * and build real elements. {@link toPlainText} returns a string, but a
 * deliberately unstructured one — the author's words with all markup
 * removed, safe for `textContent`.
 *
 * Zero runtime dependencies, on purpose (docs/adr/0011 Decision 2).
 */
export type {
  RichTextCode,
  RichTextDocument,
  RichTextEmphasis,
  RichTextInline,
  RichTextLink,
  RichTextNode,
  RichTextParagraph,
  RichTextStrong,
  RichTextText,
} from "./ast.js";
export { ALLOWED_LINK_SCHEMES, sanitizeLinkHref } from "./linkPolicy.js";
export { parseRichText } from "./parseRichText.js";
export { toPlainText } from "./toPlainText.js";

import type { RichTextNode } from "./ast.js";

/**
 * Flattens any node to the author's own words, with all markup removed.
 *
 * The result is <b>plain text, never markup</b> — it is safe for
 * `textContent`, an `aria-label`, a search index, or a canvas text
 * object, and it must never be treated as something to parse or render
 * as HTML. This is the one function here that returns a string, and it
 * deliberately returns the *least* structured form rather than the most
 * (docs/adr/0011 Decision 1: nothing in this package ever produces a
 * string of markup).
 *
 * @example
 * ```ts
 * toPlainText(parseRichText("Rooms are *two gold* a night."));
 * // "Rooms are two gold a night."
 * ```
 */
export function toPlainText(node: RichTextNode): string {
  switch (node.type) {
    case "text":
    case "code":
      return node.value;
    case "emphasis":
    case "strong":
    case "link":
    case "paragraph":
      return node.children.map(toPlainText).join("");
    case "document":
      // Blank line between paragraphs, matching the source shape a
      // creator typed, so a round trip through plain text keeps the
      // structure they can see.
      return node.children.map(toPlainText).join("\n\n");
  }
}

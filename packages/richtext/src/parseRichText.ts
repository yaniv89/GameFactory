import type { RichTextDocument, RichTextInline, RichTextParagraph } from "./ast.js";
import { sanitizeLinkHref } from "./linkPolicy.js";

/**
 * Bounds the recursive descent below. Legitimate nesting is one or two
 * deep (`**bold with *italic* inside**`); this exists so that a hostile
 * input cannot turn delimiter nesting into stack exhaustion, and so that
 * adding recursive node types later (docs/adr/0011 Decision 3's extension
 * policy) does not silently reopen that question. Past the limit, the
 * remaining source is emitted as literal text — content is never lost.
 */
const MAX_NESTING_DEPTH = 32;

/**
 * Parses Forge's restricted markup subset (docs/adr/0011 Decision 3) into
 * the {@link RichTextDocument} AST.
 *
 * This is not CommonMark and does not aim to be — it is a deliberately
 * small subset (`*emphasis*`, `**strong**`, `` `code` ``,
 * `[text](https://…)`, blank-line paragraphs) chosen so a non-programmer
 * can use it without surprises. Anything it does not recognize is left as
 * literal text: there is no input for which this throws, and no input for
 * which an author's words are dropped.
 *
 * @example
 * ```ts
 * const doc = parseRichText("Rooms are *two gold* a night.");
 * // doc.children[0].children ===
 * //   [ { type: "text", value: "Rooms are " },
 * //     { type: "emphasis", children: [{ type: "text", value: "two gold" }] },
 * //     { type: "text", value: " a night." } ]
 * ```
 */
export function parseRichText(source: string): RichTextDocument {
  const normalized = source.replace(/\r\n?/g, "\n");
  const paragraphs: RichTextParagraph[] = [];

  for (const block of splitIntoBlocks(normalized)) {
    paragraphs.push({ type: "paragraph", children: parseInline(block, 0) });
  }

  return { type: "document", children: paragraphs };
}

/**
 * Groups consecutive non-blank lines into blocks, joining the lines of
 * each block with a single space — a hard-wrapped sentence is one
 * paragraph, and only a genuinely blank line starts a new one.
 */
function splitIntoBlocks(source: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = (): void => {
    if (current.length > 0) {
      blocks.push(current.join(" "));
      current = [];
    }
  };

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") flush();
    else current.push(trimmed);
  }
  flush();

  return blocks;
}

/**
 * Tracks delimiters already proven absent from the rest of the source.
 *
 * Without this, adversarial input like a long run of unclosed `[` is
 * quadratic: every opener rescans the whole remaining string for a `]`
 * that is not there. Since "no `]` at or after index i" implies the same
 * for every j > i, one recorded failure makes all later lookups O(1).
 */
class MissingDelimiterCache {
  private readonly firstKnownAbsentIndex = new Map<string, number>();

  indexOf(source: string, delimiter: string, from: number): number {
    const knownAbsentFrom = this.firstKnownAbsentIndex.get(delimiter);
    if (knownAbsentFrom !== undefined && from >= knownAbsentFrom) return -1;

    const found = source.indexOf(delimiter, from);
    if (found === -1) this.firstKnownAbsentIndex.set(delimiter, from);
    return found;
  }
}

function parseInline(source: string, depth: number): RichTextInline[] {
  if (source === "") return [];
  if (depth >= MAX_NESTING_DEPTH) return [{ type: "text", value: source }];

  const nodes: RichTextInline[] = [];
  const missing = new MissingDelimiterCache();
  let pending = "";
  let i = 0;

  const flushPending = (): void => {
    if (pending !== "") {
      nodes.push({ type: "text", value: pending });
      pending = "";
    }
  };

  while (i < source.length) {
    const consumed =
      tryParseCode(source, i, missing) ??
      tryParseMark(source, i, "**", "strong", depth, missing) ??
      tryParseMark(source, i, "*", "emphasis", depth, missing) ??
      tryParseLink(source, i, depth, missing);

    if (consumed === undefined) {
      pending += source[i];
      i += 1;
      continue;
    }

    flushPending();
    nodes.push(...consumed.nodes);
    i = consumed.nextIndex;
  }

  flushPending();
  return nodes;
}

interface Consumed {
  readonly nodes: readonly RichTextInline[];
  readonly nextIndex: number;
}

/** `` `code` `` — content is literal, so this never recurses. */
function tryParseCode(source: string, i: number, missing: MissingDelimiterCache): Consumed | undefined {
  if (source[i] !== "`") return undefined;

  const close = missing.indexOf(source, "`", i + 1);
  if (close === -1 || close === i + 1) return undefined; // unclosed, or an empty span: literal.

  return { nodes: [{ type: "code", value: source.slice(i + 1, close) }], nextIndex: close + 1 };
}

/**
 * `*emphasis*` / `**strong**`.
 *
 * A delimiter only opens a mark when the character after it is not
 * whitespace, and only closes when the character before it is not
 * whitespace — the simplified flanking rule that keeps prose like
 * `100% * 2 = 200%` and `* *` as the literal text an author typed rather
 * than accidental formatting.
 */
function tryParseMark(
  source: string,
  i: number,
  delimiter: string,
  type: "strong" | "emphasis",
  depth: number,
  missing: MissingDelimiterCache,
): Consumed | undefined {
  if (!source.startsWith(delimiter, i)) return undefined;

  const contentStart = i + delimiter.length;
  if (isBlank(source[contentStart])) return undefined;

  let close = missing.indexOf(source, delimiter, contentStart);
  while (close !== -1 && isBlank(source[close - 1])) {
    close = missing.indexOf(source, delimiter, close + 1);
  }
  if (close === -1 || close === contentStart) return undefined;

  const content = source.slice(contentStart, close);
  return {
    nodes: [{ type, children: parseInline(content, depth + 1) }],
    nextIndex: close + delimiter.length,
  };
}

/**
 * `[text](href)`.
 *
 * A rejected scheme does not drop the node — the link's own text is
 * spliced in as ordinary inline content, so the author's words survive
 * and only the dangerous `href` is discarded (docs/adr/0011 Decision 4).
 */
function tryParseLink(source: string, i: number, depth: number, missing: MissingDelimiterCache): Consumed | undefined {
  if (source[i] !== "[") return undefined;

  const textClose = missing.indexOf(source, "]", i + 1);
  if (textClose === -1 || source[textClose + 1] !== "(") return undefined;

  const hrefClose = findBalancedParen(source, textClose + 1);
  if (hrefClose === -1) return undefined;

  const children = parseInline(source.slice(i + 1, textClose), depth + 1);
  const href = sanitizeLinkHref(source.slice(textClose + 2, hrefClose));

  return {
    nodes: href === undefined ? children : [{ type: "link", href, children }],
    nextIndex: hrefClose + 1,
  };
}

/**
 * Finds the `)` matching the `(` at <paramref>openIndex</paramref>,
 * counting nesting. Naively taking the first `)` would truncate a URL
 * that legitimately contains one — and, more to the point, would split
 * `[x](javascript:alert(1))` such that the parser saw a different string
 * than the one the browser would resolve.
 */
function findBalancedParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isBlank(character: string | undefined): boolean {
  return character === undefined || character.trim() === "";
}

/**
 * The rich text AST (docs/adr/0011 Decision 1).
 *
 * There is deliberately no HTML-string representation of any of this,
 * anywhere in this package — no `toHtml`, no `renderToString`. Consumers
 * walk these nodes and build real elements for whatever renderer they
 * have (`document.createTextNode`, React elements, PixiJS text). That is
 * the load-bearing security property: a consumer cannot assign an AST
 * node to `.innerHTML`, because there is no string of markup to assign.
 * CLAUDE.md Section 1.1 guardrail 3 is enforced here by the shape of the
 * data, not by a sanitization pass that could be bypassed.
 */

/** A run of literal characters. Always rendered as a text node — never interpreted. */
export interface RichTextText {
  readonly type: "text";
  readonly value: string;
}

/** `*emphasized*`. */
export interface RichTextEmphasis {
  readonly type: "emphasis";
  readonly children: readonly RichTextInline[];
}

/** `**strong**`. */
export interface RichTextStrong {
  readonly type: "strong";
  readonly children: readonly RichTextInline[];
}

/** `` `code` `` — its content is literal by definition, so it holds a string rather than children. */
export interface RichTextCode {
  readonly type: "code";
  readonly value: string;
}

/**
 * `[text](href)`. <b>`href` is always already-validated</b> against
 * {@link ALLOWED_LINK_SCHEMES} by the time it reaches a consumer — a link
 * node with a rejected scheme is never constructed (docs/adr/0011
 * Decision 4; the parser degrades those to their text content instead).
 * A consumer may set this on an anchor without re-checking it.
 */
export interface RichTextLink {
  readonly type: "link";
  readonly href: string;
  readonly children: readonly RichTextInline[];
}

export type RichTextInline = RichTextText | RichTextEmphasis | RichTextStrong | RichTextCode | RichTextLink;

export interface RichTextParagraph {
  readonly type: "paragraph";
  readonly children: readonly RichTextInline[];
}

export interface RichTextDocument {
  readonly type: "document";
  readonly children: readonly RichTextParagraph[];
}

export type RichTextNode = RichTextDocument | RichTextParagraph | RichTextInline;

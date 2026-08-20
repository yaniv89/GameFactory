import { describe, expect, it } from "vitest";
import { ALLOWED_LINK_SCHEMES, parseRichText, toPlainText } from "../src/index.js";
import type { RichTextInline } from "../src/index.js";

/** The parser's own shape is verbose to assert against inline; these keep the security cases readable. */
function inlines(source: string): readonly RichTextInline[] {
  const doc = parseRichText(source);
  expect(doc.children).toHaveLength(1);
  return doc.children[0]!.children;
}

function text(value: string): RichTextInline {
  return { type: "text", value };
}

describe("parseRichText: plain text", () => {
  it("wraps a bare line in one paragraph with one text node", () => {
    expect(parseRichText("Rooms are two gold a night.")).toEqual({
      type: "document",
      children: [{ type: "paragraph", children: [text("Rooms are two gold a night.")] }],
    });
  });

  it("returns an empty document for empty or whitespace-only input", () => {
    expect(parseRichText("").children).toEqual([]);
    expect(parseRichText("   \n\n  ").children).toEqual([]);
  });

  it("splits paragraphs on blank lines, collapsing runs of them", () => {
    const doc = parseRichText("First line.\n\n\n\nSecond line.");
    expect(doc.children).toHaveLength(2);
    expect(toPlainText(doc.children[0]!)).toBe("First line.");
    expect(toPlainText(doc.children[1]!)).toBe("Second line.");
  });

  it("keeps a single newline inside one paragraph as a space, not a new paragraph", () => {
    const doc = parseRichText("A wrapped\nsentence.");
    expect(doc.children).toHaveLength(1);
    expect(toPlainText(doc)).toBe("A wrapped sentence.");
  });
});

describe("parseRichText: inline marks", () => {
  it("parses emphasis, strong, and code", () => {
    expect(inlines("an *emphasized* word")).toEqual([
      text("an "),
      { type: "emphasis", children: [text("emphasized")] },
      text(" word"),
    ]);
    expect(inlines("a **strong** word")).toEqual([
      text("a "),
      { type: "strong", children: [text("strong")] },
      text(" word"),
    ]);
    expect(inlines("a `code` word")).toEqual([text("a "), { type: "code", value: "code" }, text(" word")]);
  });

  it("prefers strong over emphasis so ** is never read as two empty emphases", () => {
    expect(inlines("**both**")).toEqual([{ type: "strong", children: [text("both")] }]);
  });

  it("nests marks inside each other", () => {
    expect(inlines("**bold with *italic* inside**")).toEqual([
      {
        type: "strong",
        children: [text("bold with "), { type: "emphasis", children: [text("italic")] }, text(" inside")],
      },
    ]);
  });

  it("does not format inside a code span — its content is literal", () => {
    expect(inlines("`*not emphasis*`")).toEqual([{ type: "code", value: "*not emphasis*" }]);
  });
});

describe("parseRichText: malformed markup degrades to literal text, never an error", () => {
  it.each([
    ["*unclosed emphasis", "*unclosed emphasis"],
    ["**unclosed strong", "**unclosed strong"],
    ["`unclosed code", "`unclosed code"],
    ["[unclosed link", "[unclosed link"],
    ["[text](unclosed", "[text](unclosed"],
    ["a stray ] bracket", "a stray ] bracket"],
    ["a stray ) paren", "a stray ) paren"],
    ["100% * 2 = 200%", "100% * 2 = 200%"],
  ])("%j stays literal", (source, expected) => {
    expect(toPlainText(parseRichText(source))).toBe(expected);
  });

  it("empty marks are literal text rather than empty nodes", () => {
    expect(inlines("**")).toEqual([text("**")]);
    expect(inlines("* *")).toEqual([text("* *")]);
  });
});

describe("parseRichText: link scheme allowlist (docs/adr/0011 Decision 4)", () => {
  it("exposes the allowlist it actually enforces", () => {
    expect([...ALLOWED_LINK_SCHEMES].sort()).toEqual(["http:", "https:", "mailto:"]);
  });

  it.each(["https://example.com/a", "http://example.com", "mailto:someone@example.com"])(
    "allows %s",
    (href) => {
      expect(inlines(`[click me](${href})`)).toEqual([{ type: "link", href, children: [text("click me")] }]);
    },
  );

  it("parses inline marks inside link text", () => {
    expect(inlines("[**bold** link](https://example.com)")).toEqual([
      {
        type: "link",
        href: "https://example.com",
        children: [{ type: "strong", children: [text("bold")] }, text(" link")],
      },
    ]);
  });

  // The security core of this package. Each case is a real evasion that
  // works against naive scheme checks, because browsers strip these
  // characters before resolving a URL.
  it.each([
    ["javascript:alert(1)", "the obvious case"],
    ["JaVaScRiPt:alert(1)", "case variation"],
    ["JAVASCRIPT:alert(1)", "uppercase"],
    ["java\tscript:alert(1)", "embedded tab"],
    ["java\nscript:alert(1)", "embedded newline"],
    ["java\r\nscript:alert(1)", "embedded CRLF"],
    ["jav\u0000ascript:alert(1)", "embedded NUL"],
    ["java\u000Bscript:alert(1)", "embedded vertical tab"],
    ["javascript\u007F:alert(1)", "embedded DEL"],
    ["  javascript:alert(1)", "leading whitespace"],
    ["\u0000javascript:alert(1)", "leading NUL"],
    ["\t \njavascript:alert(1)", "leading mixed whitespace"],
    ["data:text/html,<script>alert(1)</script>", "data: URL"],
    ["vbscript:msgbox(1)", "vbscript:"],
    ["file:///etc/passwd", "file:"],
    ["/relative/path", "scheme-less relative path"],
    ["//example.com/protocol-relative", "protocol-relative URL"],
    ["#fragment", "fragment-only"],
  ])("rejects %j (%s) and keeps the author's words as plain text", (href) => {
    const parsed = inlines(`[click me](${href})`);
    expect(parsed.every((node) => node.type !== "link")).toBe(true);
    expect(toPlainText(parseRichText(`[click me](${href})`))).toBe("click me");
  });

  it("keeps surrounding text intact when a link is rejected", () => {
    expect(toPlainText(parseRichText("before [bad](javascript:alert(1)) after"))).toBe("before bad after");
  });

  it("keeps formatting inside a rejected link's text", () => {
    expect(inlines("[**shout**](javascript:alert(1))")).toEqual([
      { type: "strong", children: [text("shout")] },
    ]);
  });
});

describe("parseRichText: hostile content stays data", () => {
  it("treats HTML as literal text — there is nothing to sanitize because nothing is ever parsed as HTML", () => {
    const source = "<script>alert(1)</script>";
    expect(inlines(source)).toEqual([text(source)]);
    expect(toPlainText(parseRichText(source))).toBe(source);
  });

  it("treats an img/onerror payload as literal text", () => {
    const source = '<img src=x onerror="alert(1)">';
    expect(toPlainText(parseRichText(source))).toBe(source);
  });

  it("does not blow the stack on pathologically nested delimiters", () => {
    // Guards the recursive inline parser (docs/adr/0011 Decision 3's
    // extension policy keeps adding recursive node types, so the depth
    // bound needs to hold rather than be re-argued each time).
    const source = "*".repeat(5000) + "deep" + "*".repeat(5000);
    expect(() => parseRichText(source)).not.toThrow();
    expect(toPlainText(parseRichText(source))).toContain("deep");
  });

  it("does not lose content on a long run of bracket openers", () => {
    const source = "[".repeat(5000) + "deep";
    expect(() => parseRichText(source)).not.toThrow();
    expect(toPlainText(parseRichText(source))).toContain("deep");
  });
});

describe("toPlainText", () => {
  it("flattens every node type to the author's own words", () => {
    const doc = parseRichText("An *emphasized* and **strong** [link](https://example.com) with `code`.");
    expect(toPlainText(doc)).toBe("An emphasized and strong link with code.");
  });

  it("joins paragraphs with a blank line so the shape survives a round trip to plain text", () => {
    expect(toPlainText(parseRichText("One.\n\nTwo."))).toBe("One.\n\nTwo.");
  });
});

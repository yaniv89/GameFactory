# 11. The `@forge/richtext` AST, its markup subset, and its link policy

## Status
Accepted.

## Context

CLAUDE.md Section 1.1 guardrail 3 is unconditional: *"Never render
user-supplied content as HTML... Rich text goes through the sanitizing
AST parser in `@forge/richtext`."* `docs/security/THREAT-MODEL.md` T7
(stored XSS via dialogue text, item names, project descriptions; CWE-79,
High) names the same package as its mitigation. `packages/richtext` has
existed since the M0 scaffold as a single `notImplemented()` throw.

Two things are worth stating plainly before deciding anything, because
they change what this work actually is:

**There is no XSS bug today.** Every place user text is rendered already
uses a safe path — `packages/player/src/main.ts` sets
`speakerEl.textContent`/`textEl.textContent`, and the editor's
`PreviewApp.tsx` renders `{bubble.speaker}`/`{bubble.text}` as ordinary
React children (escaped by construction). `tools/security/rules/no-dangerous-html.yaml`
already fails CI repo-wide on `dangerouslySetInnerHTML`, `.innerHTML`,
and `.outerHTML`, so the consumer side of guardrail 3 is enforced by a
gate, not by discipline. The gap this ADR closes is therefore **not** "we
render text unsafely" — it is "we cannot render *anything but* flat
text, and the package the guardrail points at doesn't exist."

**That means the risk profile is inverted from a normal sanitizer
project.** We are not retrofitting sanitization onto an existing unsafe
renderer (where a bypass reopens a live hole). We are adding a *new
capability* — authors writing `*emphasized*` dialogue — to a system that
is currently safe by having no capability at all. The entire security
question is whether we add that capability without introducing the hole.

### The design mistake this ADR exists to avoid

The obvious implementation is "parse Markdown to HTML with a library,
then run the HTML through a sanitizer." That is the architecture behind a
large share of real-world sanitizer CVEs, and it is wrong here for a
structural reason: it *produces an HTML string*. Once a string of HTML
exists in the codebase, something eventually assigns it to `.innerHTML`
— that is precisely the footgun the semgrep rule above exists to catch,
and a package whose natural output is an HTML string is a package that
spends forever fighting its own consumers.

It also fails CLAUDE.md Section 2's dependency discipline twice over
(`marked` + `DOMPurify` are both outside the pinned list), and Section
12 item 4 already frames the intended answer to "we want richer
dialogue" as *"extend the richtext AST allowlist"* — an allowlist, not a
sanitization pass.

## Decision

### 1. Parse straight to a typed AST. Never produce an HTML string. Anywhere.

The package's public surface has **no** `toHtml()`, no
`renderToString()`, no function whose return type is a string of markup.
Input text goes directly to a discriminated-union AST; consumers walk
that AST and create real elements (`document.createTextNode`, React
elements, PixiJS text objects — whatever that consumer's renderer is).

This is the load-bearing decision. It is not "sanitize well"; it is
**never construct the dangerous representation in the first place**. A
consumer literally cannot `innerHTML` an AST node — there is no string to
assign. Sanitizer bypasses are a category of bug that this shape does not
have, rather than one it defends against.

Consequence, accepted deliberately: every consumer writes a small
renderer (D2 writes two — one React, one DOM). That is real, repeated
work, and it is the correct trade: the alternative buys brevity by
minting exactly the artifact the whole guardrail is about.

### 2. Zero runtime dependencies

Same discipline `packages/module-api` already holds. The parser is a few
hundred lines of string scanning; a dependency here would be pure
supply-chain surface on the one package whose entire job is being
trustworthy.

### 3. The v1 markup subset

Inline: `*emphasis*`, `**strong**`, `` `code` ``, `[text](url)`.
Block: paragraphs, split on blank lines.

Deliberately **excluded** from v1, each for a reason rather than by
omission:
- **Raw HTML passthrough** — never, in any version. This is the whole point.
- **Images** (`![alt](src)`) — an image URL is a real exfiltration channel
  (it fires a request to an attacker-controlled host on render, with no
  user interaction). Art comes from Art Packs and the asset pipeline
  (E track), which are content-addressed and validated; there is no
  legitimate reason for dialogue to reference an arbitrary remote image.
- **Headings, lists, blockquotes, tables** — no consumer needs them.
  Dialogue is one or two sentences. Adding them later is additive and
  therefore cheap; shipping them now is surface with no caller.

Extension policy (this is the part CLAUDE.md Section 12 item 4 promises
authors): the allowlist grows by adding a node type to the union and a
case to each renderer. It never grows by adding an "allow raw HTML"
escape hatch, and any new node type carrying a URL gets the same
treatment as `link` below.

### 4. Link `href` policy: allowlist schemes, degrade to text, never drop the author's words

`javascript:` URLs are the one genuinely dangerous thing a
non-HTML-producing parser can still emit, because the *consumer* will
eventually put the value on an `href`. So the parser resolves this, not
the consumer.

Allowed schemes: `https:`, `http:`, `mailto:`. Everything else — most
importantly `javascript:` and `data:` — is rejected.

Rejection must survive the standard evasions, all of which exploit the
fact that browsers strip characters before resolving a URL:
- case variation (`JaVaScRiPt:`),
- embedded ASCII control characters and whitespace inside the scheme
  (`java\tscript:`, `java\nscript:`, `jav\x00ascript:`),
- leading whitespace/control characters before the scheme.

So: strip all ASCII control characters (`\x00`–`\x20`, `\x7F`) from the
candidate URL, then require the result to begin with an allowed scheme,
compared case-insensitively. A URL with no scheme at all is also
rejected — relative links are meaningless in a published game served from
a content-addressed build path, and allowing them buys nothing while
widening what has to be reasoned about.

**A rejected link degrades to its own text content, keeping the author's
words.** `[click me](javascript:alert(1))` renders as the plain text
`click me`, not as nothing. Silently deleting an author's sentence
because one URL was bad is a worse failure than the one being prevented
(CLAUDE.md Section 5.3: nothing lost without a warning), and it makes the
parser's behavior explainable to a non-programmer.

### 5. Malformed markup is text, never an error

`*unclosed` is the literal text `*unclosed`. A creator typing an asterisk
in dialogue gets an asterisk, not a parse error and not a swallowed
sentence. The parser therefore has no failure mode that loses content —
its worst case is "this renders as exactly what you typed."

## Consequences

- **What this closes:** the guardrail-3 package exists and is real;
  authors can emphasize a word in dialogue; T7's named mitigation is
  implemented rather than aspirational.
- **What it costs:** a per-consumer renderer (see Decision 1), and D2
  writes the first two.
- **What stays out of scope:** images, headings, lists, tables, and any
  form of raw-HTML passthrough (Decision 3); a rich-text *editing* UI —
  authors type the markup subset in the existing plain `Line` field, and
  a WYSIWYG editor is a separate, later piece of work with no bearing on
  this parser's safety.
- **Testing bar:** the security-relevant behavior (scheme allowlist and
  its evasions) is tested as adversarial cases, not just happy paths —
  CLAUDE.md Section 9 puts security tests at 100%, no exceptions. The
  hostile-input cases live alongside the parser's own unit tests rather
  than in a separate fixture directory, since they are assertions about
  this one pure function.

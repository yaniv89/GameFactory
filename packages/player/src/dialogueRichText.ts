import { parseRichText, type RichTextInline } from "@forge/richtext";

/**
 * Renders dialogue text into `container` as real DOM nodes built by
 * walking `@forge/richtext`'s AST — never `.innerHTML`, never a markup
 * string (docs/adr/0011 Decision 1). `container.ownerDocument` supplies
 * `createElement`/`createTextNode` so this works against both the real
 * page `document` and a jsdom one in tests.
 *
 * Replaces main.ts's old `textEl.textContent = text`, which was safe but
 * flattened every dialogue line to plain text. This is D2: the render-side
 * half of docs/adr/0011 (D1 built the parser; a consumer still had to
 * build a real renderer for each of the editor preview and this player).
 */
export function renderDialogueRichText(container: HTMLElement, source: string): void {
  const document = container.ownerDocument;
  container.replaceChildren();

  const doc = parseRichText(source);
  doc.children.forEach((paragraph, index) => {
    if (index > 0) container.appendChild(document.createElement("br"));
    for (const inline of paragraph.children) appendInlineNode(document, container, inline);
  });
}

function appendInlineNode(document: Document, parent: Node, node: RichTextInline): void {
  switch (node.type) {
    case "text":
      parent.appendChild(document.createTextNode(node.value));
      return;
    case "emphasis": {
      const el = document.createElement("em");
      for (const child of node.children) appendInlineNode(document, el, child);
      parent.appendChild(el);
      return;
    }
    case "strong": {
      const el = document.createElement("strong");
      for (const child of node.children) appendInlineNode(document, el, child);
      parent.appendChild(el);
      return;
    }
    case "code": {
      const el = document.createElement("code");
      el.appendChild(document.createTextNode(node.value));
      parent.appendChild(el);
      return;
    }
    case "link": {
      // node.href is already validated against ALLOWED_LINK_SCHEMES by
      // parseRichText (docs/adr/0011 Decision 4) — a link node with a
      // rejected scheme is never constructed, so there is nothing left to
      // re-check here.
      const el = document.createElement("a");
      el.setAttribute("href", node.href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      for (const child of node.children) appendInlineNode(document, el, child);
      parent.appendChild(el);
      return;
    }
  }
}

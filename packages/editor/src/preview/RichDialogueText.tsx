import { parseRichText, type RichTextInline } from "@forge/richtext";
import { Fragment } from "react";

/**
 * Renders dialogue text as real React elements built by walking
 * `@forge/richtext`'s AST — never `dangerouslySetInnerHTML` (docs/adr/0011
 * Decision 1). This is the editor-preview half of D2; packages/player/src/
 * dialogueRichText.ts is the same thing built against the real DOM instead
 * of React, for the exported/published player.
 */
export function RichDialogueText({ text }: { readonly text: string }) {
  const doc = parseRichText(text);
  return (
    <>
      {doc.children.map((paragraph, paragraphIndex) => (
        <Fragment key={paragraphIndex}>
          {paragraphIndex > 0 && <br />}
          {paragraph.children.map((inline, inlineIndex) => (
            <RichInline key={inlineIndex} node={inline} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

function RichInline({ node }: { readonly node: RichTextInline }) {
  switch (node.type) {
    case "text":
      return <>{node.value}</>;
    case "emphasis":
      return (
        <em>
          {node.children.map((child, index) => (
            <RichInline key={index} node={child} />
          ))}
        </em>
      );
    case "strong":
      return (
        <strong>
          {node.children.map((child, index) => (
            <RichInline key={index} node={child} />
          ))}
        </strong>
      );
    case "code":
      return <code>{node.value}</code>;
    case "link":
      // node.href is already validated against ALLOWED_LINK_SCHEMES by
      // parseRichText (docs/adr/0011 Decision 4) — a link node with a
      // rejected scheme is never constructed, so there is nothing left to
      // re-check before handing it to a real <a href>.
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer">
          {node.children.map((child, index) => (
            <RichInline key={index} node={child} />
          ))}
        </a>
      );
  }
}

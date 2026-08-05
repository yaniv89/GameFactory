import type { Preview } from "@storybook/react";
import React from "react";
import "../src/global.css";

/**
 * RTL toggle: CLAUDE.md 5.7 requires testing with a real Hebrew locale in
 * Playwright, not just a flipped `dir` on English text — this Storybook
 * toggle is for quick visual iteration on mirroring/logical-property bugs
 * during development, not a substitute for that Playwright suite.
 */
const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "abyss",
      values: [{ name: "abyss", value: "#12161c" }],
    },
    a11y: {
      // Contrast + focus-visibility checks run against every story.
      config: {},
      options: {},
    },
  },
  globalTypes: {
    direction: {
      name: "Direction",
      description: "Text direction (mirrors editor chrome, never the scene canvas — CLAUDE.md 5.7)",
      defaultValue: "ltr",
      toolbar: {
        icon: "globe",
        items: [
          { value: "ltr", title: "LTR (English)" },
          { value: "rtl", title: "RTL (עברית)" },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const dir = context.globals.direction ?? "ltr";
      return (
        <div dir={dir} style={{ background: "var(--surface-abyss)", padding: "var(--space-5)", minHeight: "100vh" }}>
          <Story />
        </div>
      );
    },
  ],
};

export default preview;

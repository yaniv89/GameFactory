import type { Preview } from "@storybook/react";
import React from "react";
import "@forge/ds/dist/global.css";

/**
 * Same RTL-toggle-for-visual-iteration pattern as @forge/ds's own preview
 * (packages/design-system/.storybook/preview.tsx) — quick mirroring/
 * logical-property checks during development, not a substitute for the
 * real Hebrew-locale Playwright suite CLAUDE.md 5.7 requires.
 */
const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "abyss",
      values: [{ name: "abyss", value: "#12161c" }],
    },
    a11y: {
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

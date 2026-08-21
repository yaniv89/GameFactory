import { coreGraphNodes } from "@forge/graph-nodes-core";
import { describe, expect, it } from "vitest";
import { NODE_REGISTRY, defaultConfigFor, groupNodesByCategory } from "./nodeRegistry";

describe("NODE_REGISTRY", () => {
  it("has one entry per @forge/graph-nodes-core definition, matched by type", () => {
    expect(Object.keys(NODE_REGISTRY).sort()).toEqual(coreGraphNodes.map((node) => node.type).sort());
  });

  it("every entry's editor metadata has a non-empty label and category", () => {
    for (const entry of Object.values(NODE_REGISTRY)) {
      expect(entry.editor.label.length).toBeGreaterThan(0);
      expect(entry.editor.category.length).toBeGreaterThan(0);
    }
  });
});

describe("defaultConfigFor", () => {
  it("returns {} for a node type with no config fields", () => {
    expect(defaultConfigFor("core:add")).toEqual({});
  });

  it("returns an empty object for an unknown node type rather than throwing", () => {
    expect(defaultConfigFor("nonexistent:type")).toEqual({});
  });

  it("pulls the repeat node's default ceiling from its schema", () => {
    expect(defaultConfigFor("core:repeat")).toEqual({ ceiling: 1000 });
  });

  it("converts core:forEachEntity's comma-separated default through fromFormValues into a real empty array", () => {
    expect(defaultConfigFor("core:forEachEntity")).toEqual({ components: [] });
  });
});

describe("groupNodesByCategory", () => {
  it("groups every registered node under its own category, none missing", () => {
    const groups = groupNodesByCategory();
    const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
    expect(total).toBe(Object.keys(NODE_REGISTRY).length);
    expect(groups.map((group) => group.category).sort()).toEqual(["Comparisons", "Component", "Data", "Entity", "Events", "Flow", "Math"]);
  });
});

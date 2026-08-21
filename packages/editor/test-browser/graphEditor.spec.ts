import { expect, test } from "./fixtures";

/**
 * docs/adr/0017's authoring layer (M3), proven end to end in a real
 * browser — jsdom (GraphEditorDialog.test.tsx) already proves the
 * component's own logic against a fake store, but React Flow's actual
 * canvas (SVG/DOM node+edge rendering, drag-connect) only ever runs for
 * real here, the same "jsdom can't do this" reasoning sceneCanvas.spec.ts
 * and packSwapDialog.spec.ts already use for their own canvases.
 */
test.describe("Graph editor, in a real browser", () => {
  test("create a graph, open it, add a node from the palette, and see it on the real React Flow canvas", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Create a graph" }).click();

    await expect(page.getByLabel("Name").first()).toHaveValue("Graph 1");
    await page.getByRole("button", { name: "Open", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Graph — Graph 1")).toBeVisible();

    await dialog.getByRole("complementary", { name: "Node palette" }).getByRole("button", { name: "Add" }).click();

    // The real React Flow canvas rendered a node — not just store state.
    const canvasNode = dialog.locator(".react-flow__node").filter({ hasText: "Add" });
    await expect(canvasNode).toBeVisible();

    // The keyboard/screen-reader parallel (CLAUDE.md 5.6) shows the same node.
    const outline = dialog.getByRole("tree", { name: "Graph Outline" });
    await expect(outline.getByText("Add")).toBeVisible();

    // Selecting it from the outline shows the node inspector with a real Delete action.
    await outline.getByText("Add").click();
    await expect(dialog.getByRole("button", { name: "Delete node" })).toBeVisible();

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("connecting two nodes via the keyboard connect-picker draws a real edge on the canvas", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create a graph" }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();

    const dialog = page.getByRole("dialog");
    const palette = dialog.getByRole("complementary", { name: "Node palette" });
    await palette.getByRole("button", { name: "Add" }).click();
    await palette.getByRole("button", { name: "Add" }).click();

    const outline = dialog.getByRole("tree", { name: "Graph Outline" });
    await outline.getByText("Add").first().click();
    await dialog.getByRole("button", { name: /Output: result/ }).click();
    await dialog.getByRole("button", { name: /Add\.a/ }).click();

    // A real SVG edge path now exists on the React Flow canvas.
    await expect(dialog.locator(".react-flow__edge")).toHaveCount(1);
  });
});

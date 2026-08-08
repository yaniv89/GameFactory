import { expect, test } from "@playwright/test";

/**
 * docs/SPEC.md Section 11.5's hero interaction, proven end to end in a
 * real browser: apply a real diff-backed swap and watch the canvas
 * re-render live (no reload — the TilemapLayer.refreshTextures path),
 * then one-click restore the automatic checkpoint and watch it revert,
 * also live. Reuses sceneCanvas.spec.ts's own pixel-reading technique
 * (draw the live <canvas> onto a scratch 1x1 canvas), since Section
 * 11.5's claims are about what actually reaches the screen, not about
 * store state that happens to look right.
 */
test.describe("Pack-swap dialog, in a real browser", () => {
  test("Apply swaps the live canvas without a reload, and the automatic checkpoint restores it", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    const canvasPanel = page.locator(".fg-scene-canvas");
    await canvasPanel.getByRole("radiogroup", { name: "Tile to paint" }).waitFor({ state: "visible" });

    const canvas = page.locator(".fg-scene-canvas__surface");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("SceneCanvas: canvas element has no bounding box");

    // Same "bottom-right grid corner, clear of the floating toolbar"
    // targeting as sceneCanvas.spec.ts — see that spec's own comment.
    const point = await page.evaluate(() => {
      const debug = (
        window as unknown as {
          __forgeSceneCanvasDebug: {
            camera: { worldToScreen(x: number, y: number): { x: number; y: number } };
            layer: { gridWidth: number; gridHeight: number; tileSize: number };
          };
        }
      ).__forgeSceneCanvasDebug;
      const { gridWidth, gridHeight, tileSize } = debug.layer;
      const worldX = (gridWidth - 1) * tileSize + tileSize / 2;
      const worldY = (gridHeight - 1) * tileSize + tileSize / 2;
      return debug.camera.worldToScreen(worldX, worldY);
    });
    const clickX = Math.floor(point.x);
    const clickY = Math.floor(point.y);

    interface PixiApplicationLike {
      renderer: { render(target: unknown): void };
      stage: unknown;
      canvas: CanvasImageSource;
    }

    const pixelAt = (x: number, y: number) =>
      page.evaluate(
        ({ x, y }) => {
          const debug = (window as unknown as { __forgeSceneCanvasDebug: { host: { app: PixiApplicationLike } } })
            .__forgeSceneCanvasDebug;
          const { app } = debug.host;
          app.renderer.render(app.stage);
          const probe = document.createElement("canvas");
          probe.width = 1;
          probe.height = 1;
          const ctx = probe.getContext("2d")!;
          ctx.drawImage(app.canvas, x, y, 1, 1, 0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        },
        { x, y },
      );

    // No pack active yet: painting Grass renders tilePalette.ts's flat
    // default (74, 124, 60) — the same baseline sceneCanvas.spec.ts checks.
    await canvas.click({ position: { x: clickX, y: clickY } });
    expect(await pixelAt(clickX, clickY)).toEqual([74, 124, 60, 255]);

    await page.getByRole("button", { name: "Swap Art Pack" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });

    await dialog.getByLabel("Switch to").selectOption("@forge-fixtures/starter-pack");
    // No pack was active, so this is a first install, not a swap — the
    // diff resolves to a single "no active pack" finding, not a fetch
    // race with anything to compare against.
    await expect(dialog.getByText(/No pack is currently active/)).toBeVisible();

    await dialog.getByRole("button", { name: "Apply swap" }).click();
    await expect(dialog).not.toBeVisible();

    // Live re-render, no reload: TilemapLayer.refreshTextures re-slices
    // the already-painted tile against the newly active pack.
    await expect
      .poll(() => pixelAt(clickX, clickY), { timeout: 5000 })
      .toEqual([34, 139, 34, 255]); // starter-pack's real grass color, not the flat default.

    await page.getByRole("button", { name: "Swap Art Pack" }).click();
    await dialog.waitFor({ state: "visible" });
    await expect(dialog.getByText(/Before installing @forge-fixtures\/starter-pack/)).toBeVisible();

    await dialog.getByRole("button", { name: "Restore" }).click();
    await expect(dialog).not.toBeVisible();

    // The checkpoint's snapshot had no active pack — restoring it should
    // bring the flat-color fallback back, live, the same way applying did.
    await expect
      .poll(() => pixelAt(clickX, clickY), { timeout: 5000 })
      .toEqual([74, 124, 60, 255]);

    expect(consoleErrors).toEqual([]);
  });
});

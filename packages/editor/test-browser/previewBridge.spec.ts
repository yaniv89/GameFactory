import { expect, test } from "@playwright/test";

/**
 * Proves the cross-origin preview bridge (docs/SPEC.md 10.6) for real, in
 * a real browser — not just the message-validation unit tests
 * (PreviewPanel.test.tsx / protocol.test.ts), which can't exercise an
 * actual sandboxed iframe or a real MessageEvent.origin. Two things only
 * a real browser can prove:
 * 1. The isolation is real: the parent cannot reach into the preview
 *    iframe's document at all (sandbox="allow-scripts" with no
 *    allow-same-origin gives it a browser-enforced opaque origin).
 * 2. The bridge actually carries live data: painting a tile in the
 *    editor's Canvas panel is reflected in the Preview panel's own,
 *    independently-rendered pixels — not shared state, a real
 *    postMessage round trip.
 */
test.describe("cross-origin preview bridge, in a real browser", () => {
  test("the preview iframe is genuinely isolated and mirrors a live paint", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    // Tiles are real, undoable scene document state now (M6 Phase 5b) —
    // painting needs a scene to persist into.
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.waitForSelector(".fg-preview-panel__frame");

    // 1. Isolation: the parent's own script cannot reach the sandboxed
    // iframe's document — this is the actual security boundary, not a
    // same-origin convenience that happens to look isolated. Chromium
    // raises SecurityError here; the exact error type is an
    // implementation detail, so this only asserts that access is denied.
    const access = await page.evaluate(() => {
      const iframe = document.querySelector(".fg-preview-panel__frame") as HTMLIFrameElement;
      try {
        void iframe.contentWindow?.document;
        return "accessible";
      } catch (err) {
        return `blocked: ${(err as Error).name}`;
      }
    });
    expect(access).toMatch(/^blocked:/);

    // 2. The preview panel reaches "ready" only once it has validated a
    // real forge:preview:ready message from that opaque-origin iframe —
    // this waits on the actual bridge, not a fixed timeout.
    const previewPanel = page.locator(".fg-preview-panel");
    await expect(previewPanel.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });

    // 3. Paint a tile in the editor's Canvas panel.
    const canvasSurface = page.locator(".fg-scene-canvas__surface");
    await canvasSurface.waitFor({ state: "visible" });
    const box = await canvasSurface.boundingBox();
    if (!box) throw new Error("SceneCanvas: canvas element has no bounding box");
    // Not the panel's literal center: the camera fits the whole grid into
    // the canvas on boot, which at this panel's aspect ratio letterboxes
    // it horizontally, and the floating tool toolbar + tile palette
    // (.fg-scene-canvas__controls, anchored top-left) covers most of that
    // letterboxed strip's height at the default docked panel size. The
    // grid's own bottom-right corner tile is guaranteed clear of both
    // (same reasoning and technique as sceneCanvas.spec.ts's real-browser
    // paint test, which hit this exact overlap first).
    const paintPoint = await page.evaluate(() => {
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
    await canvasSurface.click({ position: { x: Math.floor(paintPoint.x), y: Math.floor(paintPoint.y) } });

    // 4. Read the actual pixel inside the preview iframe's own canvas —
    // reached via Playwright's frame API (which isn't subject to the
    // same-origin-policy the browser enforces for in-page JS, unlike the
    // access check above), proving the painted tile really arrived.
    const previewFrame = page.frameLocator("iframe.fg-preview-panel__frame");
    const previewCanvas = previewFrame.locator(".fg-preview-app__surface");
    await previewCanvas.waitFor({ state: "visible" });

    // Give the rAF-coalesced sync (SceneCanvas) and the postMessage round
    // trip (PreviewPanel -> preview iframe) a moment to land.
    await page.waitForTimeout(200);

    const pixel = await previewCanvas.evaluate((canvasEl) => {
      // Pixi renders on its own ticker schedule, not synchronously when a
      // sprite changes — force a render so the canvas reflects the latest
      // tile data before sampling it (same technique sceneCanvas.spec.ts
      // uses for the same reason, via the same import.meta.env.DEV-only
      // debug hook pattern).
      const debug = (
        window as unknown as {
          __forgePreviewDebug?: {
            host: { app: { renderer: { render(target: unknown): void }; stage: unknown } };
            camera: { worldToScreen(x: number, y: number): { x: number; y: number } };
            layer: { gridWidth: number; gridHeight: number; tileSize: number };
          };
        }
      ).__forgePreviewDebug;
      debug?.host.app.renderer.render(debug.host.app.stage);

      // Sample the same grid tile that was painted (the grid's bottom-right
      // corner) — the preview has its own independent camera/layer, fitted
      // to its own panel size, so this is not necessarily the same pixel
      // as the editor canvas's click point.
      const { gridWidth, gridHeight, tileSize } = debug!.layer;
      const worldX = (gridWidth - 1) * tileSize + tileSize / 2;
      const worldY = (gridHeight - 1) * tileSize + tileSize / 2;
      const screen = debug!.camera.worldToScreen(worldX, worldY);

      const canvas = canvasEl as HTMLCanvasElement;
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      const ctx = probe.getContext("2d")!;
      ctx.drawImage(canvas, Math.floor(screen.x), Math.floor(screen.y), 1, 1, 0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });

    // The default-selected palette entry is "Grass" (0x4a7c3c), fully opaque.
    expect(pixel).toEqual([74, 124, 60, 255]);
    expect(consoleErrors).toEqual([]);
  });
});

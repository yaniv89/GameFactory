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
    await canvasSurface.click({ position: { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) } });

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
          __forgePreviewDebug?: { host: { app: { renderer: { render(target: unknown): void }; stage: unknown } } };
        }
      ).__forgePreviewDebug;
      debug?.host.app.renderer.render(debug.host.app.stage);

      const canvas = canvasEl as HTMLCanvasElement;
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      const ctx = probe.getContext("2d")!;
      ctx.drawImage(canvas, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, 0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });

    // The default-selected palette entry is "Grass" (0x4a7c3c), fully opaque.
    expect(pixel).toEqual([74, 124, 60, 255]);
    expect(consoleErrors).toEqual([]);
  });
});

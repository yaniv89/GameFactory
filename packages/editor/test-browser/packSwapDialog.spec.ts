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

  /**
   * docs/SPEC.md Section 5.8's "live side-by-side preview with a
   * draggable comparison divider" and Section 11.5's "Remap manually,"
   * proven together: starter-pack's real 'water' tile has no equivalent
   * in desert-pack (both real, checked-in fixture packs, same
   * grid.tileSize so the mismatch-fallback path never masks the result —
   * see fixturePack.test.ts's own note on why desert-pack exists
   * specifically for this). Before remapping, the preview's target side
   * shows the flat-color placeholder; after remapping 'water' -> 'sand',
   * it shows desert-pack's own real sand texture — and so does the real
   * canvas, live, once applied.
   */
  test("Preview changes renders both packs for real, and a manual remap changes what both the preview and the applied canvas render", async ({
    page,
  }) => {
    // More than the file's other test needs: this one does two full
    // preview renders (each its own async pack-texture load + WebGL
    // extract pass) on top of the usual paint/dialog/apply/restore flow.
    test.setTimeout(60000);
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.addInitScript(
      ({ key, version }) => {
        const persisted = {
          state: {
            document: { scenes: [], installedModules: {}, activePack: "@forge-fixtures/starter-pack", packOverrides: {}, packTerrainRemap: {} },
            past: [],
            future: [],
            checkpoints: [],
          },
          version,
        };
        window.localStorage.setItem(key, JSON.stringify(persisted));
      },
      { key: "forge:editor:project-document", version: 4 },
    );

    await page.goto("/");
    const canvasPanel = page.locator(".fg-scene-canvas");
    await canvasPanel.getByRole("radiogroup", { name: "Tile to paint" }).waitFor({ state: "visible" });

    const canvas = page.locator(".fg-scene-canvas__surface");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("SceneCanvas: canvas element has no bounding box");

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

    const mainPixelAt = (x: number, y: number) =>
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

    // Paint the same bottom-right cell with "Water" — starter-pack's own
    // real water color, not the flat default, so the preview/remap steps
    // below are diffing real pack art, not placeholders.
    await canvasPanel.getByRole("radio", { name: "Water" }).click();
    await canvas.click({ position: { x: clickX, y: clickY } });
    await expect.poll(() => mainPixelAt(clickX, clickY)).toEqual([0, 105, 148, 255]);

    await page.getByRole("button", { name: "Swap Art Pack" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByLabel("Switch to").selectOption("@forge-fixtures/desert-pack");
    await expect(dialog.getByText(/1 prop has no equivalent: 'water'/)).toBeVisible();

    await dialog.getByRole("button", { name: "Preview changes" }).click();

    // Same layout math PackSwapPreview.tsx itself uses: PREVIEW_WIDTH/
    // PREVIEW_HEIGHT (420x315) is exactly proportional to the 20x15 grid
    // at TILE_SIZE 32 (640x480, also 4:3), so the whole grid fills the
    // preview canvas edge to edge with zero letterboxing and world
    // coordinates scale directly by that one ratio.
    //
    // Unlike the main canvas's debug hook, this one exposes the two
    // already-drawn, plain 2D preview canvases directly (not a live Pixi
    // renderer to force-render) — PackSwapPreview renders each side once,
    // via `extract.canvas`, and draws the result onto these with a
    // one-time `drawImage`, so there's nothing left to force a render of
    // by the time this reads them.
    const previewPixelAt = (role: "sourceCanvas" | "targetCanvas", x: number, y: number) =>
      page.evaluate(
        ({ role, x, y }) => {
          const debug = (window as unknown as { __forgePackSwapPreviewDebug?: Record<"sourceCanvas" | "targetCanvas", HTMLCanvasElement | undefined> })
            .__forgePackSwapPreviewDebug;
          const canvasEl = debug?.[role];
          if (!canvasEl) return undefined;
          const probe = document.createElement("canvas");
          probe.width = 1;
          probe.height = 1;
          const ctx = probe.getContext("2d")!;
          ctx.drawImage(canvasEl, x, y, 1, 1, 0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        },
        { role, x, y },
      );

    const previewZoom = 420 / (20 * 32);
    const previewWorldX = (20 - 1) * 32 + 16;
    const previewWorldY = (15 - 1) * 32 + 16;
    const previewX = Math.floor(previewWorldX * previewZoom);
    const previewY = Math.floor(previewWorldY * previewZoom);

    // Before remapping: source shows starter-pack's real water; target
    // shows the flat-color placeholder (desert-pack has no 'water' tag).
    await expect.poll(() => previewPixelAt("sourceCanvas", previewX, previewY), { timeout: 5000 }).toEqual([0, 105, 148, 255]);
    await expect.poll(() => previewPixelAt("targetCanvas", previewX, previewY), { timeout: 5000 }).toEqual([58, 110, 165, 255]);

    await dialog.getByRole("button", { name: "Remap manually" }).click();
    await dialog.getByLabel("'water' ->").selectOption("sand");

    // After remapping 'water' -> 'sand': target now shows desert-pack's
    // real sand texture, not the placeholder — and the source side is
    // untouched (starter-pack still declares 'water' itself).
    await expect.poll(() => previewPixelAt("targetCanvas", previewX, previewY), { timeout: 5000 }).toEqual([237, 201, 175, 255]);
    await expect.poll(() => previewPixelAt("sourceCanvas", previewX, previewY), { timeout: 5000 }).toEqual([0, 105, 148, 255]);

    // "Apply anyway", not "Apply swap": this scenario has a real FAIL
    // finding (desert-pack has no 'water' equivalent), which relabels
    // the button per PackSwapDialog's own hasFailures check — the label
    // change is honest UI, not a bug to route around.
    await dialog.getByRole("button", { name: "Apply anyway" }).click();
    await expect(dialog).not.toBeVisible();

    // The remap was already committed to the project document when it
    // was chosen (not a preview-only draft) — applying just swaps the
    // active pack, and the same remap the preview already reflected now
    // shows up on the real, live canvas too.
    await expect.poll(() => mainPixelAt(clickX, clickY), { timeout: 5000 }).toEqual([237, 201, 175, 255]);

    expect(consoleErrors).toEqual([]);
  });
});

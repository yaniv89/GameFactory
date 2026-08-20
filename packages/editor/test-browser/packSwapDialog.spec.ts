import { expect, test } from "./fixtures";

// Real, measured mean colors of the packs' own textured tiles (computed
// directly from the committed PNGs, not guessed) -- exact-match pixel
// assertions no longer work now that these are real photo-crop textures
// rather than flat placeholder fills (see packRendering.spec.ts's own
// comment on the same issue). Tolerances are generous enough to cover
// each tile's own measured stddev at whatever point ends up sampled.
const STARTER_GRASS_MEAN_RGB = [68, 137, 31];
const STARTER_WATER_MEAN_RGB = [19, 191, 193];
const DESERT_SAND_MEAN_RGB = [244, 213, 185];
const TILE_TOLERANCE = 60;

function isNearColor(actual: number[] | undefined, expectedRgb: number[], tolerance = TILE_TOLERANCE): boolean {
  if (!actual || actual[3] !== 255) return false;
  return expectedRgb.every((expected, channel) => Math.abs(actual[channel]! - expected) <= tolerance);
}

function expectNearColor(actual: number[] | undefined, expectedRgb: number[], tolerance = TILE_TOLERANCE): void {
  expect(actual, "pixel was undefined").toBeDefined();
  expect(actual![3]).toBe(255);
  for (let channel = 0; channel < 3; channel++) {
    expect(
      Math.abs(actual![channel]! - expectedRgb[channel]!),
      `channel ${channel}: got ${actual![channel]}, expected near ${expectedRgb[channel]} (+/-${tolerance})`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

// Polls (like the exact-match `.poll().toEqual()` this replaces used to)
// until the sampled pixel actually becomes near `expectedRgb` -- needed
// because a live re-render is async (a new texture fetch/slice), and a
// poll that only checks "some real pixel is here" (e.g. alpha === 255)
// can pass trivially on a still-stale previous frame.
async function pollNearColor(sample: () => Promise<number[] | undefined>, expectedRgb: number[], tolerance = TILE_TOLERANCE): Promise<void> {
  await expect.poll(async () => isNearColor(await sample(), expectedRgb, tolerance), { timeout: 5000 }).toBe(true);
}

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
    // Tiles are real, undoable scene document state now (M6 Phase 5b) —
    // painting needs a scene to persist into.
    await page.getByRole("button", { name: "Create a scene" }).click();

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
    // starter-pack's own real, textured grass tile, not the flat default.
    await pollNearColor(() => pixelAt(clickX, clickY), STARTER_GRASS_MEAN_RGB);

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
    // Tiles are real, undoable scene document state now (M6 Phase 5b) —
    // painting needs a scene to persist into.
    await page.getByRole("button", { name: "Create a scene" }).click();

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
    await pollNearColor(() => mainPixelAt(clickX, clickY), STARTER_WATER_MEAN_RGB);

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
    await pollNearColor(() => previewPixelAt("sourceCanvas", previewX, previewY), STARTER_WATER_MEAN_RGB);
    await expect.poll(() => previewPixelAt("targetCanvas", previewX, previewY), { timeout: 5000 }).toEqual([58, 110, 165, 255]);

    await dialog.getByRole("button", { name: "Remap manually" }).click();
    await dialog.getByLabel("'water' ->").selectOption("sand");

    // After remapping 'water' -> 'sand': target now shows desert-pack's
    // real sand texture, not the placeholder — and the source side is
    // untouched (starter-pack still declares 'water' itself).
    await pollNearColor(() => previewPixelAt("targetCanvas", previewX, previewY), DESERT_SAND_MEAN_RGB);
    expectNearColor(await previewPixelAt("sourceCanvas", previewX, previewY), STARTER_WATER_MEAN_RGB);

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
    await pollNearColor(() => mainPixelAt(clickX, clickY), DESERT_SAND_MEAN_RGB);

    expect(consoleErrors).toEqual([]);
  });
});

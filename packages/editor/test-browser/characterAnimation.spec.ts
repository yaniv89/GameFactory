import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1a's own exit bar, in a real browser: the player entity in the live
 * preview is drawn from `fixtures/packs/starter-pack/characters/hero_walk.png`
 * (a real, generated 4-direction/4-frame walk cycle — `characterTextures.ts`
 * + `createCharacterAnimationSystem`), not the flat cyan placeholder circle
 * `entityMarkers.ts` still falls back to when no pack art resolves. Two
 * things only a real browser proves: the pack's manifest/image actually
 * fetches and slices correctly through `resolveAsset`'s tiers, and the
 * rendered pixel at the player's own position is real character art, not a
 * flat marker color — a unit test asserting `Sprite.frame` advances can't
 * tell those apart on its own (the frame advances either way; only the
 * pixel proves art loaded).
 */

const TILE_SIZE = 32;
// Deliberately clear of the floating tool toolbar/palette anchored over
// the canvas's top-left corner (same reasoning walkableDemo.spec.ts's own
// PLAYER_START comment gives) — a tile under it would have this test's
// mouse click land on the toolbar, not the canvas, and silently place
// nothing.
const PLAYER_START = { x: 3, y: 11 };
// (0x3f, 0x6d, 0xa8) — HERO's tunic color (gensprite_h1.py), covering
// enough of the 32x48 frame that the sprite's own center (its anchor
// point) reliably lands on it rather than a transparent margin.
const HERO_TUNIC_RGB = [0x3f, 0x6d, 0xa8];
const PLACEHOLDER_CYAN_RGBA = [0x5e, 0xc8, 0xf2, 255];
const GRASS_RGBA = [74, 124, 60, 255];

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    host: { app: { renderer: { render(target: unknown): void }; stage: unknown; canvas: CanvasImageSource } };
    camera: { worldToScreen(x: number, y: number): { x: number; y: number } };
    gameWorld: {
      playerEntity: number | undefined;
      world: { get(id: number, component: string): Record<string, number> | undefined };
    } | null;
  };
}

function getPreviewFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes("preview.html"));
  if (!frame) throw new Error("preview iframe not found among page.frames()");
  return frame;
}

function tileWorldCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

async function screenPointForTile(page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator(".fg-scene-canvas__surface");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("SceneCanvas surface has no bounding box");
  const world = tileWorldCenter(tileX, tileY);
  const screen = await page.evaluate(
    ([wx, wy]) => {
      const debug = (window as unknown as { __forgeSceneCanvasDebug: { camera: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
        .__forgeSceneCanvasDebug;
      return debug.camera.worldToScreen(wx, wy);
    },
    [world.x, world.y] as [number, number],
  );
  return { x: box.x + screen.x, y: box.y + screen.y };
}

async function playerCenterPixel(previewFrame: Frame): Promise<number[]> {
  return previewFrame.evaluate(() => {
    const debug = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!;
    const gameWorld = debug.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
    debug.host.app.renderer.render(debug.host.app.stage);
    const screen = debug.camera.worldToScreen(transform.x!, transform.y!);
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(debug.host.app.canvas as CanvasImageSource, Math.floor(screen.x), Math.floor(screen.y), 1, 1, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  });
}

async function playerSpriteFrame(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.get(gameWorld.playerEntity!, "Sprite")!.frame!;
  });
}

test.describe("H1a: real animated character sprites, in a real browser", () => {
  test("the live preview draws the player from the active pack's hero sheet, and the walk cycle actually advances", async ({ page }) => {
    // console errors only, not `pageerror`: `addInitScript` below runs in
    // every frame, including the sandboxed preview iframe itself, which by
    // design (no `allow-same-origin`) throws reading `window.localStorage`
    // there — an expected, harmless side effect of this test's own setup
    // technique, not a product bug. Same reasoning packSwapDialog.spec.ts's
    // own `addInitScript`-based test applies.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Same technique packSwapDialog.spec.ts uses: pre-seed the persisted
    // project store with an active pack before the app boots, so this test
    // doesn't have to also drive the pack-swap dialog UI end to end.
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
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    const playerStartPoint = await screenPointForTile(page, PLAYER_START.x, PLAYER_START.y);
    await page.mouse.click(playerStartPoint.x, playerStartPoint.y);

    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    const previewSurface = previewFrame.locator(".fg-preview-app__surface");
    await previewSurface.waitFor({ state: "visible" });
    await previewSurface.click();

    await previewFrame.waitForFunction(
      () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld?.playerEntity !== undefined,
      undefined,
      { timeout: 5_000, polling: 100 },
    );

    // 1. The active pack's real art loaded and is what's actually on
    // screen at the player's position — not the placeholder marker, not
    // the bare grass tile underneath it. Checked against the hero sheet's
    // own tunic color (its single largest contiguous region, so the
    // sprite's anchor-centered sample point is very likely inside it) with
    // a per-channel tolerance for filtering/scaling, rather than exact
    // equality.
    const isRoughlyTunicColored = (pixel: number[]) => HERO_TUNIC_RGB.every((channel, i) => Math.abs(pixel[i]! - channel) <= 40);
    await expect
      .poll(async () => isRoughlyTunicColored(await playerCenterPixel(previewFrame)), {
        timeout: 5_000,
        message: "player pixel never became the hero sheet's own tunic color",
      })
      .toBe(true);
    const initialPixel = await playerCenterPixel(previewFrame);
    expect(initialPixel).not.toEqual(PLACEHOLDER_CYAN_RGBA);
    expect(initialPixel).not.toEqual(GRASS_RGBA);

    // 2. Standing still: parked on frame 0 (idle pose) of whatever facing
    // it starts on — this repo's own default.
    expect(await playerSpriteFrame(previewFrame)).toBe(0);

    // 3. Walk right for a bit and sample Sprite.frame repeatedly — the
    // walk cycle should actually advance through more than one frame
    // while moving, proving createCharacterAnimationSystem is driving it
    // live, not just spawning it at the placeholder default and leaving
    // it there.
    await page.keyboard.down("ArrowRight");
    const seenFrames = new Set<number>();
    for (let i = 0; i < 12; i++) {
      seenFrames.add(await playerSpriteFrame(previewFrame));
      await page.waitForTimeout(60);
    }
    await page.keyboard.up("ArrowRight");

    expect(seenFrames.size).toBeGreaterThan(1);
    for (const frame of seenFrames) {
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(16); // 4 directions x 4 frames
    }

    // 4. Stopping returns it to an idle pose (column 0 of whichever row
    // it's now facing), and the pixel is still real hero art, not a
    // texture that silently reverted to the placeholder mid-walk.
    await page.waitForTimeout(300);
    const stoppedFrame = await playerSpriteFrame(previewFrame);
    expect(stoppedFrame % 4).toBe(0);
    const stoppedPixel = await playerCenterPixel(previewFrame);
    expect(stoppedPixel).not.toEqual(PLACEHOLDER_CYAN_RGBA);

    expect(consoleErrors).toEqual([]);
  });
});

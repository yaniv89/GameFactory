import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * I1c's own exit bar, in a real browser: pressing "R" spawns a real
 * wielded-weapon entity that visibly follows the player — tracking both
 * position and facing every tick, not just at the moment of equipping —
 * and pressing "R" again removes it. `equipment.test.ts` (in `@forge/core`)
 * already proves the pure equip/unequip/tracking logic in isolation; this
 * proves the real keyboard binding and the real Pixi sprite creation/
 * destruction actually wire together.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 10, y: 10 }; // clear of the demo enemy/mount, no interaction needed for this spec
const EQUIPMENT_NO_WEAPON = 0xffffffff; // must match @forge/core's own EQUIPMENT_NO_WEAPON sentinel
const WEAPON_OFFSET = 16; // must match PreviewApp.tsx's own WEAPON_OFFSET

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      world: {
        get(id: number, component: string): Record<string, number> | undefined;
        isAlive(id: number): boolean;
      };
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

async function equipmentState(previewFrame: Frame): Promise<{ weaponEntity: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const equipment = gameWorld.world.get(gameWorld.playerEntity!, "Equipment")!;
    return { weaponEntity: equipment.weaponEntity! };
  });
}

async function weaponAlive(previewFrame: Frame, weaponEntity: number): Promise<boolean> {
  return previewFrame.evaluate((entity) => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.isAlive(entity);
  }, weaponEntity);
}

async function weaponTransform(previewFrame: Frame, weaponEntity: number): Promise<{ x: number; y: number; rotation: number }> {
  return previewFrame.evaluate((entity) => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(entity, "Transform")!;
    return { x: transform.x!, y: transform.y!, rotation: transform.rotation! };
  }, weaponEntity);
}

async function playerTransform(previewFrame: Frame): Promise<{ x: number; y: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
    return { x: transform.x!, y: transform.y! };
  });
}

test.describe("I1c: equip/unequip and wielded-weapon rendering, in a real browser", () => {
  test("R equips a real weapon entity that tracks the player every tick, and R again removes it", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

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

    // Bare-handed at spawn — no weapon entity yet.
    const beforeEquip = await equipmentState(previewFrame);
    expect(beforeEquip.weaponEntity).toBe(EQUIPMENT_NO_WEAPON);
    const spawnPlayer = await playerTransform(previewFrame);

    // Equip.
    await page.keyboard.press("r");
    await page.waitForTimeout(50);
    const afterEquip = await equipmentState(previewFrame);
    expect(afterEquip.weaponEntity).not.toBe(EQUIPMENT_NO_WEAPON);
    expect(await weaponAlive(previewFrame, afterEquip.weaponEntity)).toBe(true);

    const spawnWeaponTransform = await weaponTransform(previewFrame, afterEquip.weaponEntity);
    // The player spawns facing south (Animator's own default facing, 0) —
    // the weapon renders straight below, x unchanged.
    expect(spawnWeaponTransform.x).toBeCloseTo(spawnPlayer.x, 0);
    expect(spawnWeaponTransform.y).toBeCloseTo(spawnPlayer.y + WEAPON_OFFSET, 0);

    // Walk east — the weapon must genuinely follow, not stay parked at the
    // equip-moment position.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(50);

    const walkedPlayer = await playerTransform(previewFrame);
    expect(walkedPlayer.x).toBeGreaterThan(spawnPlayer.x); // the player really moved east

    const trackedWeapon = await weaponTransform(previewFrame, afterEquip.weaponEntity);
    expect(trackedWeapon.x).toBeGreaterThan(spawnWeaponTransform.x); // and the weapon moved with it
    expect(trackedWeapon.x).toBeCloseTo(walkedPlayer.x + WEAPON_OFFSET, 0); // still exactly WEAPON_OFFSET east of the player, now facing east

    // Unequip: the weapon entity is genuinely destroyed, not just hidden.
    await page.keyboard.press("r");
    await page.waitForTimeout(50);
    const afterUnequip = await equipmentState(previewFrame);
    expect(afterUnequip.weaponEntity).not.toBe(afterEquip.weaponEntity);
    expect(await weaponAlive(previewFrame, afterEquip.weaponEntity)).toBe(false);

    expect(consoleErrors).toEqual([]);
  });
});

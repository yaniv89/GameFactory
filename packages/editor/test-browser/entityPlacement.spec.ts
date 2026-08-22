import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * K1's own real, load-bearing gap, closed: before this, Enemy and Mount
 * only ever existed as PreviewApp.tsx's own single hardcoded demo spawns
 * (`DEMO_ENEMY_TILE`/`DEMO_MOUNT_TILE`) — an author could place a Player
 * start or an NPC through SceneCanvas's toolbar, but had no way to place
 * an Enemy or a Mount at all (`ENEMY_PREFAB`/`MOUNT_PREFAB` already
 * existed in the core prefab registry; nothing in the editor UI ever
 * exposed them). This proves the new "Enemy"/"Mount" tools actually place
 * a real entity, that `reconcilePlacedEntities` (PreviewApp.tsx) spawns it
 * for real in the live preview alongside the untouched single demo
 * enemy/mount, and that the *generic* ECS combat/mount systems — which
 * already query broadly by component, not by a specific hardcoded entity
 * id (`createEnemyAiSystem`'s `["Transform","Velocity","Health","EnemyAi"]`
 * query, `createMountSystem`'s own nearest-unridden-mount search) — work
 * on an author-placed entity exactly the same as they already do on the
 * demo one, with zero system-level changes needed.
 */

const TILE_SIZE = 32;
// Deliberately far from PreviewApp.tsx's own DEMO_ENEMY_TILE (13, 8) and
// DEMO_MOUNT_TILE (5, 8) — this spec's own placed entities must never be
// confused with, or collide with, those pre-existing fixed spawns — and
// clear of the floating tool toolbar's own top-left corner over the
// canvas (SceneCanvas.css .fg-scene-canvas__controls; walkableDemo.spec.ts's
// own PLAYER_START comment has the same warning).
const PLAYER_START = { x: 2, y: 11 };
const PLACED_ENEMY_TILE = { x: 3, y: 11 }; // one tile east of the player — the same reach geometry meleeAttack.spec.ts's own PLAYER_START/DEMO_ENEMY_TILE pair already proves reliable
const PLACED_MOUNT_TILE = { x: 3, y: 11 }; // one tile east of the player in the mount test's own separate scene — within MOUNT_PREFAB's own mount.range (40)

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      enemyEntitiesByPlacementId: Map<string, number>;
      mountEntitiesByPlacementId: Map<string, number>;
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

async function clickTile(page: Page, tileX: number, tileY: number): Promise<void> {
  const point = await screenPointForTile(page, tileX, tileY);
  await page.mouse.click(point.x, point.y);
}

async function waitForPlayerEntity(previewFrame: Frame): Promise<void> {
  await previewFrame.waitForFunction(
    () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld?.playerEntity !== undefined,
    undefined,
    { timeout: 5_000, polling: 100 },
  );
}

async function placedEnemyEntity(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const [id] = gameWorld.enemyEntitiesByPlacementId.values();
    if (id === undefined) throw new Error("no placed enemy found in enemyEntitiesByPlacementId");
    return id;
  });
}

async function placedMountEntity(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const [id] = gameWorld.mountEntitiesByPlacementId.values();
    if (id === undefined) throw new Error("no placed mount found in mountEntitiesByPlacementId");
    return id;
  });
}

test.describe("K1: Enemy/Mount placement through the real editor UI", () => {
  test("placing an Enemy through SceneCanvas's toolbar spawns a real, damageable entity in the live preview", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    // The real placement, through the real toolbar tool — not a store call.
    // Aggro left on (unlike some other combat specs) — this deliberately
    // exercises the same real chase/attack `enemyAi.spec.ts` proves,
    // now against an author-placed entity instead of the demo one.
    await page.getByRole("radio", { name: "Enemy" }).click();
    await clickTile(page, PLACED_ENEMY_TILE.x, PLACED_ENEMY_TILE.y);

    // Placing it auto-selected it — the Inspector's own hint copy for this
    // prefab is real UI, not just a store-level fact.
    await expect(page.getByText("Hostile on sight")).toBeVisible();

    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    const previewSurface = previewFrame.locator(".fg-preview-app__surface");
    await previewSurface.waitFor({ state: "visible" });
    await previewSurface.click();
    await waitForPlayerEntity(previewFrame);

    const enemyEntity = await placedEnemyEntity(previewFrame);
    const initialHealth = await previewFrame.evaluate(
      (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.get(id, "Health")!.current!,
      enemyEntity,
    );
    expect(initialHealth).toBe(30); // ENEMY_PREFAB's own health.current — the real prefab, not a stub

    // Face east, swing — the exact reach geometry meleeAttack.spec.ts's own
    // PLAYER_START/DEMO_ENEMY_TILE pair already proves reliable, reused
    // here at this scene's own coordinates.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);

    const damagedHealth = await previewFrame.evaluate(
      (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.get(id, "Health")!.current!,
      enemyEntity,
    );
    expect(damagedHealth).toBeLessThan(initialHealth); // a real, generic combat system found and damaged this author-placed entity

    // Finish it off — proves the whole death path (destroy, coin drop) runs
    // for an author-placed enemy exactly as it does for the demo one.
    for (let attempt = 0; attempt < 6; attempt++) {
      const alive = await previewFrame.evaluate(
        (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.isAlive(id),
        enemyEntity,
      );
      if (!alive) break;
      await page.keyboard.press(" ");
      await page.waitForTimeout(550);
    }
    expect(
      await previewFrame.evaluate(
        (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.isAlive(id),
        enemyEntity,
      ),
    ).toBe(false);

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("placing a Mount through SceneCanvas's toolbar spawns a real, rideable entity in the live preview", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "Mount" }).click();
    await clickTile(page, PLACED_MOUNT_TILE.x, PLACED_MOUNT_TILE.y);
    await expect(page.getByText("The player can ride this")).toBeVisible();

    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    const previewSurface = previewFrame.locator(".fg-preview-app__surface");
    await previewSurface.waitFor({ state: "visible" });
    await previewSurface.click();
    await waitForPlayerEntity(previewFrame);

    const mountEntity = await placedMountEntity(previewFrame);
    const playerEntity = await previewFrame.evaluate(() => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.playerEntity!);

    // No NPC exists in this scene, so "E" falls straight through to the
    // (generic, entity-id-agnostic) mount system — the same one the
    // pre-existing demo mount already exercises, now finding this
    // author-placed one instead.
    await page.keyboard.press("e");
    await page.waitForTimeout(50);

    const riderEntity = await previewFrame.evaluate(
      (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.get(id, "Mount")!.riderEntity!,
      mountEntity,
    );
    expect(riderEntity).toBe(playerEntity);
    const maxSpeed = await previewFrame.evaluate(
      (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.get(id, "Velocity")!.maxSpeed!,
      playerEntity,
    );
    expect(maxSpeed).toBe(260); // MOUNT_PREFAB's own mount.mountedMaxSpeed — the real prefab, not a stub

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});

import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1f's own exit bar, in a real browser: every named beat (footstep,
 * swing, impact, death, pickup) actually calls into a real, unlocked
 * `AudioContext` while playing the live preview. `previewAudio.test.ts`
 * already proves each cue's own synthesis shape (waveform, frequency,
 * envelope) against a fake `AudioContext` in isolation; this proves the
 * real event wiring in `PreviewApp.tsx` actually fires them, and that the
 * browser's autoplay-gesture unlock (`resume()`) actually happens, by
 * monkey-patching `window.AudioContext` before the app boots and counting
 * calls to each synthesis entry point (`createOscillator`/
 * `createBufferSource`) rather than trying to assert on real audible
 * output, which Playwright has no reliable way to observe.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 12, y: 8 }; // one tile west of DEMO_ENEMY_TILE — see meleeAttack.spec.ts's own comment
const MELEE_REACH = 24; // must match PreviewApp.tsx's own MELEE_REACH

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      enemyEntity: number;
      world: {
        get(id: number, component: string): Record<string, number> | undefined;
        set(id: number, component: string, value: Record<string, number>): void;
        flush(): void;
      };
    } | null;
  };
  __audioProbe?: { oscillatorCount: number; bufferSourceCount: number; resumeCount: number };
  /** The live `AudioContext` instance itself — kept separately from `__audioProbe`'s plain counters so a poll can read its real, current `.state` (which changes asynchronously after `resume()` returns) rather than a stale snapshot taken at call time. */
  __audioProbeContext?: AudioContext;
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

async function audioProbe(previewFrame: Frame) {
  return previewFrame.evaluate(() => (window as unknown as PreviewDebugWindow).__audioProbe!);
}

async function repositionPlayerNextToEnemy(previewFrame: Frame): Promise<void> {
  await previewFrame.evaluate((reach) => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const enemyTransform = gameWorld.world.get(gameWorld.enemyEntity, "Transform")!;
    gameWorld.world.set(gameWorld.enemyEntity, "Velocity", { vx: 0, vy: 0 });
    gameWorld.world.set(gameWorld.playerEntity!, "Transform", { x: enemyTransform.x! - reach, y: enemyTransform.y! });
    gameWorld.world.flush();
  }, MELEE_REACH);
}

test.describe("H1f: audio on every beat, in a real browser", () => {
  test("footstep, swing, impact, death, and pickup all synthesize real sound through a real (probe-wrapped) AudioContext", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // Installed before any navigation, so it's in place before the preview
    // iframe's own `previewAudio.ts` module ever calls `new AudioContext()`.
    // A thin proxy over the real class, not a fake: every node it hands
    // back is a genuine native AudioContext node the real oscillator/noise
    // synthesis code in previewAudio.ts actually drives — the probe only
    // counts calls, it never replaces the Web Audio implementation itself.
    await page.addInitScript(() => {
      const probe = { oscillatorCount: 0, bufferSourceCount: 0, resumeCount: 0 };
      (window as unknown as { __audioProbe: typeof probe }).__audioProbe = probe;
      class ProbedAudioContext extends AudioContext {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          (window as unknown as { __audioProbeContext: AudioContext }).__audioProbeContext = this;
        }
        override createOscillator(...args: Parameters<AudioContext["createOscillator"]>): OscillatorNode {
          probe.oscillatorCount++;
          return super.createOscillator(...args);
        }
        override createBufferSource(...args: Parameters<AudioContext["createBufferSource"]>): AudioBufferSourceNode {
          probe.bufferSourceCount++;
          return super.createBufferSource(...args);
        }
        override resume(...args: Parameters<AudioContext["resume"]>): Promise<void> {
          probe.resumeCount++;
          return super.resume(...args);
        }
      }
      window.AudioContext = ProbedAudioContext;
    });

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

    const beforeAnything = await audioProbe(previewFrame);
    expect(beforeAnything.oscillatorCount).toBe(0);
    expect(beforeAnything.bufferSourceCount).toBe(0);
    expect(beforeAnything.resumeCount).toBe(0);

    // 1. Footstep: walk far enough (maxSpeed 140/s) to cross at least one
    // FOOTSTEP_STRIDE_DISTANCE (26 world units).
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowDown");

    // The very first keydown (above) is also the real autoplay-gesture
    // unlock — resume() was called, and the context settles into
    // "running" asynchronously once the browser actually processes it
    // (a real AudioContext.resume() promise, not instantaneous).
    const afterWalking = await audioProbe(previewFrame);
    expect(afterWalking.resumeCount).toBeGreaterThan(0);
    await previewFrame.waitForFunction(
      () => (window as unknown as PreviewDebugWindow).__audioProbeContext!.state === "running",
      undefined,
      { timeout: 2_000, polling: 50 },
    );
    expect(afterWalking.bufferSourceCount).toBeGreaterThan(0); // at least one footstep's noise burst

    // 2. Swing (whoosh) + 3. Impact (on a real hit) + 4. Death (on the
    // killing blow) — same real 3-swing sequence damageAndDeath.spec.ts
    // establishes.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);
    // The footstep walk above (straight down) displaced the player off
    // the enemy's own row — reposition exactly `MELEE_REACH` away before
    // every swing from here on, the same way damageAndDeath.spec.ts
    // already does for its own second and third swings. Facing itself
    // stays "east" (set by the tap above, untouched by a Transform-only
    // reposition) across every one of these.
    await repositionPlayerNextToEnemy(previewFrame);

    const beforeSwing = await audioProbe(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);
    const afterFirstSwing = await audioProbe(previewFrame);
    // Swing is a noise burst (bufferSource), impact is a tone (oscillator) — both fire on a landed hit.
    expect(afterFirstSwing.bufferSourceCount).toBeGreaterThan(beforeSwing.bufferSourceCount);
    expect(afterFirstSwing.oscillatorCount).toBeGreaterThan(beforeSwing.oscillatorCount);

    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);

    const beforeLethalSwing = await audioProbe(previewFrame);
    await page.keyboard.press(" "); // the lethal third swing
    await page.waitForTimeout(50);
    const afterDeath = await audioProbe(previewFrame);
    // Impact (combat:hit) + death (combat:death) both fire on the killing blow: at least two new oscillator calls.
    expect(afterDeath.oscillatorCount).toBeGreaterThanOrEqual(beforeLethalSwing.oscillatorCount + 2);

    // 5. Pickup: walk onto the coin the kill dropped.
    const beforePickupWalk = await audioProbe(previewFrame);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");
    const afterPickup = await audioProbe(previewFrame);
    // The pickup chime alone is two oscillator notes (previewAudio.ts's own playPickup shape).
    expect(afterPickup.oscillatorCount).toBeGreaterThanOrEqual(beforePickupWalk.oscillatorCount + 2);

    expect(consoleErrors).toEqual([]);
  });
});

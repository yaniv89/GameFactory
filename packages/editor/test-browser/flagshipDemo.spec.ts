import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * K1: the flagship demo — "Wolf's Hollow," a small, complete RPG built
 * entirely through the real editor UI (this script drives every tool the
 * same way a person's mouse/keyboard would), using `starter-pack`'s real,
 * non-placeholder art (not a flat-color fixture), and genuinely showing
 * off the whole platform in one place: painted walls and a doorway
 * (H1g), a branching-dialogue NPC (M10/M13), a quest with an objective
 * (M8/M13) started and completed by a graph (M6), a data table a graph
 * reads for a real heal amount (M11/M13), the *existing* single demo
 * enemy/mount (H1c/I1b) plus a *second*, author-placed enemy through K1
 * Phase 1's own new "Enemy" tool — proving that capability with real
 * content, not just its own isolated test.
 *
 * This is deliberately both an authoring script AND a real play-through:
 * per CLAUDE.md guardrail 23 ("never call a game-layer feature done from
 * a passing test suite alone... it gets played"), the assertions below
 * don't just check that entities exist — they walk to the NPC, pick a
 * real dialogue branch, kill both goblins for real, and confirm the
 * quest actually completes and the graph-driven heal actually lands.
 * Once proven, the finished `ProjectDocument` is read back out (via
 * `App.tsx`'s own dev-only `__forgeProjectStoreDebug` escape hatch — the
 * real backend "Export Project" button needs a signed-in `projectId`
 * this E2E-skip-auth harness never has) and saved as
 * `fixtures/projects/flagship-demo/document.json`, the same
 * `--document`-shaped fixture `packages/cli/src/commands/export.ts`
 * already knows how to build and run.
 */

const TILE_SIZE = 32;
const WALL_X = 10;
const DOORWAY_Y = 7;
const PLAYER_START = { x: 3, y: 11 }; // walkableDemo.spec.ts's own proven-safe spot, clear of the toolbar's own top-left corner
const NPC_TILE = { x: 7, y: 11 }; // same safe row, a short walk east of spawn
const PLACED_ENEMY_TILE = { x: 15, y: 8 }; // room 2 (east of the wall), near the existing single demo enemy at (13, 8) — a second goblin, placed through K1 Phase 1's own new tool
const MELEE_REACH = 24;

const QUEST_NAME = "Clear the Goblins";
const QUEST_DESCRIPTION = "Two goblins have overrun the east wing. Deal with them.";
const OBJECTIVE_DESCRIPTION = "Defeat both goblins";
const NODE_0 = { speaker: "Shopkeeper", text: "Goblins have overrun the east wing. Will you help?" };
const NODE_1 = { speaker: "Shopkeeper", text: "Thank you, brave one! Watch yourself out there." };
const CHOICE_HELP = "I'll clear them out";
const CHOICE_DECLINE = "Not today";
const HEAL_AMOUNT = 30;

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 2;
const FIXTURE_PACK_NAME = "@forge-fixtures/starter-pack";

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      enemyEntity: number;
      enemyEntitiesByPlacementId: Map<string, number>;
      world: {
        get(id: number, component: string): Record<string, number> | undefined;
        set(id: number, component: string, value: Record<string, number>): void;
        flush(): void;
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

async function dragPaintColumn(page: Page, tileX: number, yStart: number, yEnd: number): Promise<void> {
  const start = await screenPointForTile(page, tileX, yStart);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const step = yEnd >= yStart ? 1 : -1;
  for (let y = yStart; y !== yEnd + step; y += step) {
    const point = await screenPointForTile(page, tileX, y);
    await page.mouse.move(point.x, point.y, { steps: 2 });
  }
  await page.mouse.up();
}

async function enemyAlive(previewFrame: Frame, entityId: number): Promise<boolean> {
  return previewFrame.evaluate(
    (id) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.world.isAlive(id),
    entityId,
  );
}

async function repositionPlayerNextTo(previewFrame: Frame, targetEntity: number, reach: number): Promise<void> {
  await previewFrame.evaluate(
    ([target, r]) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      const targetTransform = gameWorld.world.get(target, "Transform")!;
      gameWorld.world.set(target, "Velocity", { vx: 0, vy: 0 });
      gameWorld.world.set(gameWorld.playerEntity!, "Transform", { x: targetTransform.x! - r, y: targetTransform.y! });
      gameWorld.world.flush();
    },
    [targetEntity, reach] as [number, number],
  );
}

async function waitForPlayerXAtLeast(previewFrame: Frame, threshold: number, timeout: number): Promise<void> {
  await previewFrame.waitForFunction(
    (min: number) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld;
      if (gameWorld?.playerEntity === undefined) return false;
      const transform = gameWorld.world.get(gameWorld.playerEntity, "Transform");
      return transform !== undefined && transform.x! >= min;
    },
    threshold,
    { timeout, polling: 100 },
  );
}

async function killEnemy(page: Page, previewFrame: Frame, entityId: number): Promise<void> {
  for (let attempt = 0; attempt < 8 && (await enemyAlive(previewFrame, entityId)); attempt++) {
    await repositionPlayerNextTo(previewFrame, entityId, MELEE_REACH);
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
  }
  expect(await enemyAlive(previewFrame, entityId)).toBe(false);
}

test.describe("K1: the flagship demo, built entirely through the real editor UI", () => {
  test("Wolf's Hollow — quest, branching dialogue, a graph-driven heal, and real placed combat, all real and played", async ({ page }) => {
    // `addInitScript` below runs in every frame, including the sandboxed
    // preview iframe itself, which by design (no `allow-same-origin`)
    // throws reading `window.localStorage` there — an expected, harmless
    // side effect of this test's own setup technique, not a product bug
    // (characterAnimation.spec.ts's own established reasoning for the
    // identical localStorage-preseed pattern). That spec avoids ever
    // seeing it by not listening for `pageerror` at all; this test does
    // listen (real uncaught exceptions elsewhere in a play-through this
    // long are worth catching), so it filters this one specific, understood
    // message instead of dropping pageerror coverage entirely.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      if (err.message.includes("sandboxed and lacks the 'allow-same-origin' flag")) return;
      consoleErrors.push(err.message);
    });

    await page.addInitScript(() => {
      (window as unknown as { __forgeTestDisableEnemyAggro: boolean }).__forgeTestDisableEnemyAggro = true;
    });
    // starter-pack active from the very first render — packRendering.spec.ts's
    // own established pattern for genuinely authoring against a real pack,
    // not retrofitting the field onto the export afterward.
    //
    // installedModules is seeded explicitly with the subset of
    // migrateDocument's own DEFAULT_INSTALLED_MODULES this demo's content
    // actually exercises — dialogue, graph-runtime, and quests all need to
    // be "installed" for real, not just authored, or PreviewApp.tsx's
    // `installedModules.includes("@forge/dialogue")` guard leaves
    // `dialogueRef.current` null and "E" never finds the NPC. Passing an
    // *explicit* document (as this init script does) bypasses
    // migrateDocument's own `document === undefined` fresh-project default,
    // per its own doc comment — an explicit `installedModules: {}` here
    // would otherwise migrate to a genuinely empty set, not the default
    // one. `@forge/inventory` is deliberately left out even though
    // DEFAULT_INSTALLED_MODULES includes it for a fresh editor project —
    // this demo's coin pickup is core ECS/PreviewApp wiring, not the
    // inventory module's own guest bundle, and `packages/player` (the real
    // export target) never declares `@forge/inventory` as a dependency at
    // all (neither does fixtures/projects/starter-rpg's own installedModules)
    // — installing it here would fail `forge export`'s real, file://-target
    // module-resolution step for a module this demo never actually uses.
    await page.addInitScript(
      ({ key, version, activePack }) => {
        const persisted = {
          state: {
            document: {
              scenes: [],
              installedModules: {
                "@forge/dialogue": { config: {} },
                "@forge/graph-runtime": { config: {} },
                "@forge/quests": { config: {} },
              },
              activePack,
              packOverrides: {},
            },
            past: [],
            future: [],
          },
          version,
        };
        window.localStorage.setItem(key, JSON.stringify(persisted));
      },
      { key: PERSIST_KEY, version: PERSIST_VERSION, activePack: FIXTURE_PACK_NAME },
    );

    await page.goto("/");

    // --- Quest ---
    const questsRegion = page.getByRole("region", { name: "Quests" });
    await questsRegion.getByRole("button", { name: "Create a quest" }).click();
    const questId = await questsRegion.locator(".fg-quests-list__header .fg-id-tag").innerText();
    await questsRegion.getByLabel("Name").fill(QUEST_NAME);
    await questsRegion.getByLabel("Description").fill(QUEST_DESCRIPTION);
    await questsRegion.getByLabel("Description").blur();
    await questsRegion.getByRole("button", { name: "Add objective" }).click();
    const objectiveId = await questsRegion.locator(".fg-quests-list__objective-row .fg-id-tag").innerText();
    await questsRegion.getByLabel("Objective").fill(OBJECTIVE_DESCRIPTION);
    await questsRegion.getByLabel("Objective").blur();

    // --- Data table: what a goblin's dropped coin heals the player for. ---
    const tablesRegion = page.getByRole("region", { name: "Data Tables" });
    await tablesRegion.getByRole("button", { name: "Create a data table" }).click();
    await tablesRegion.getByLabel("Name").fill("Goblin Loot");
    await tablesRegion.getByLabel("Name").blur();
    const tableId = await tablesRegion.locator(".fg-graphs-list__row .fg-id-tag").innerText();
    await tablesRegion.getByRole("button", { name: "Open" }).click();
    const tableDialog = page.getByRole("dialog");
    await tableDialog.getByLabel("Paste CSV to import").fill(`id,amount\n1,${HEAL_AMOUNT}`);
    await tableDialog.getByRole("button", { name: "Import CSV" }).click();
    const columnRows = tableDialog.locator(".fg-data-table-editor__column-row");
    await expect(columnRows).toHaveCount(2);
    const keyColumnId = await columnRows.nth(0).locator(".fg-id-tag").innerText();
    const amountColumnId = await columnRows.nth(1).locator(".fg-id-tag").innerText();
    await tableDialog.getByLabel("Column name").first().click();
    await page.keyboard.press("Escape");
    await expect(tableDialog).toHaveCount(0);

    // --- Scene: two rooms, a doorway, the party. ---
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Wall" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Wall" }).click();
    await dragPaintColumn(page, WALL_X, 0, DOORWAY_Y - 1);
    await dragPaintColumn(page, WALL_X, 14, DOORWAY_Y + 1);

    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "NPC" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);
    await page.getByLabel("Speaker").fill(NODE_0.speaker);
    await page.getByLabel("Line").fill(NODE_0.text);
    await page.getByLabel("Line").blur();

    // A second goblin, placed through K1 Phase 1's own new tool.
    await page.getByRole("radio", { name: "Enemy" }).click();
    await clickTile(page, PLACED_ENEMY_TILE.x, PLACED_ENEMY_TILE.y);

    // --- The Shopkeeper's branching line. ---
    await page.getByRole("radio", { name: "Select" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);
    await page.getByRole("button", { name: "Edit branching dialogue…" }).click();
    const dialogueDialog = page.getByRole("dialog");
    const dialogueOutline = dialogueDialog.getByRole("tree", { name: "Dialogue Outline" });
    await dialogueDialog.getByRole("button", { name: "Add line" }).click();
    await dialogueDialog.getByLabel("Speaker", { exact: true }).fill(NODE_1.speaker);
    await dialogueDialog.getByLabel("Line", { exact: true }).fill(NODE_1.text);
    await dialogueDialog.getByLabel("Line", { exact: true }).blur();
    await dialogueOutline.getByRole("treeitem").first().click();
    await dialogueDialog.getByRole("button", { name: "Add choice" }).click();
    await dialogueDialog.getByLabel("Choice text").fill(CHOICE_HELP);
    await dialogueDialog.getByLabel("Choice text").blur();
    await dialogueDialog.getByLabel("Leads to").selectOption("1");
    await dialogueDialog.getByRole("button", { name: "Add choice" }).click();
    await dialogueDialog.getByLabel("Choice text").last().fill(CHOICE_DECLINE);
    await dialogueDialog.getByLabel("Choice text").last().blur();
    // dialog.press("Escape") targets the dialog's own (non-focusable) div;
    // focus a real element inside it first so the keydown actually bubbles
    // through Dialog's own onKeyDown handler (same pattern
    // branchingDialogueMechanic.spec.ts's own closing sequence uses).
    await dialogueDialog.getByLabel("Choice text").last().click();
    await page.keyboard.press("Escape");
    await expect(dialogueDialog).toHaveCount(0);

    // --- The graph: pickup -> quest complete -> table-driven heal. ---
    const graphsRegion = page.getByRole("region", { name: "Graphs" });
    await graphsRegion.getByRole("button", { name: "Create a graph" }).click();
    await graphsRegion.getByRole("button", { name: "Open", exact: true }).click();
    const graphDialog = page.getByRole("dialog");
    const palette = graphDialog.getByRole("complementary", { name: "Node palette" });
    const outline = graphDialog.getByRole("tree", { name: "Graph Outline" });

    async function addNode(paletteLabel: string): Promise<void> {
      await palette.getByRole("button", { name: paletteLabel }).click();
    }
    async function selectOutline(label: string, position: "only" | "first" | "last" = "only"): Promise<void> {
      const matches = outline.getByText(label);
      const target = position === "first" ? matches.first() : position === "last" ? matches.last() : matches;
      await target.click();
    }
    async function fillField(fieldLabel: string, value: string, blur = true): Promise<void> {
      const input = graphDialog.getByLabel(fieldLabel);
      await input.fill(value);
      if (blur) await input.blur();
    }
    async function wire(
      fromLabel: string,
      fromPosition: "only" | "first" | "last",
      outputSocket: string,
      toLabel: string,
      toPosition: "only" | "first" | "last",
    ): Promise<void> {
      await selectOutline(fromLabel, fromPosition);
      await graphDialog.getByRole("button", { name: new RegExp(`^Output: ${outputSocket} \\(`) }).click();
      const targets = graphDialog.getByRole("button", { name: new RegExp(`^${toLabel} \\(`) });
      const target = toPosition === "first" ? targets.first() : toPosition === "last" ? targets.last() : targets;
      await target.click();
    }

    await addNode("On Event");
    await selectOutline("On Event");
    await fillField("Event name", "pickup:collected");

    await addNode("Get Field");
    await selectOutline("Get Field");
    await fillField("Field name", "player");

    await addNode("Start Quest");
    await selectOutline("Start Quest");
    await fillField("Quest ID", questId);

    await addNode("Complete Objective");
    await selectOutline("Complete Objective");
    await fillField("Quest ID", questId, false);
    await fillField("Objective ID", objectiveId);

    await addNode("Constant (number)");
    await selectOutline("Constant (number)");
    await fillField("Value", "1");

    await addNode("Lookup Row");
    await selectOutline("Lookup Row");
    await fillField("Table ID", tableId, false);
    await fillField("Key column", keyColumnId);

    await addNode("Get Field");
    await selectOutline("Get Field", "last");
    await fillField("Field name", amountColumnId);

    await addNode("Set Field");
    await selectOutline("Set Field");
    await fillField("Field name", "current");

    await addNode("Set Component");
    await selectOutline("Set Component");
    await fillField("Component", "Health");

    await wire("On Event", "only", "flow", "Start Quest.flow", "only");
    await wire("Start Quest", "only", "flow", "Complete Objective.flow", "only");
    await wire("Complete Objective", "only", "flow", "Set Component.flow", "only");
    await wire("On Event", "only", "payload", "Get Field.object", "first");
    await wire("Get Field", "first", "value", "Start Quest.entity", "only");
    await wire("Get Field", "first", "value", "Complete Objective.entity", "only");
    await wire("Get Field", "first", "value", "Set Component.entity", "only");
    await wire("Constant (number)", "only", "value", "Lookup Row.key", "only");
    await wire("Lookup Row", "only", "row", "Get Field.object", "last");
    await wire("Get Field", "last", "value", "Set Field.value", "only");
    await wire("Set Field", "only", "object", "Set Component.value", "only");

    await expect(graphDialog.locator(".react-flow__edge")).toHaveCount(11);
    await graphDialog.getByLabel("Name").first().click();
    await page.keyboard.press("Escape");
    await expect(graphDialog).toHaveCount(0);

    // --- Play it. ---
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

    // Talk to the Shopkeeper first — walk east to the NPC and pick a real branch.
    const npcWorld = tileWorldCenter(NPC_TILE.x, NPC_TILE.y);
    await page.keyboard.down("ArrowRight");
    await waitForPlayerXAtLeast(previewFrame, npcWorld.x - 30, 8_000);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.press("e");
    const bubble = previewFrame.locator(".fg-preview-app__dialogue");
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    await expect(bubble.locator(".fg-preview-app__dialogue-speaker")).toHaveText(NODE_0.speaker);
    const choices = previewFrame.locator(".fg-preview-app__dialogue-choice");
    await expect(choices).toHaveCount(2);
    await choices.filter({ hasText: CHOICE_HELP }).click();
    await expect(bubble.locator(".fg-preview-app__dialogue-text")).toHaveText(NODE_1.text);

    // Damage the player so the graph-driven heal is unmistakably real. The
    // graph's own "Set Field" node (below) wraps the looked-up amount into
    // a fresh `{current: n}` patch — it *sets* Health.current to the table
    // value, it does not add to whatever health the player already had
    // (questAndDataTableMechanic.spec.ts's own "healing to 25 from 100
    // would be indistinguishable from 'did nothing in particular'" already
    // established this same "heal to a fixed, table-driven value" shape).
    // Damaging to some value distinguishable from HEAL_AMOUNT itself, not
    // "100 - amount - 1", proves the final read is really the table's own
    // number and not just an artifact of the pre-damage arithmetic.
    await previewFrame.evaluate(() => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      gameWorld.world.set(gameWorld.playerEntity!, "Health", { current: 5, max: 100 });
      gameWorld.world.flush();
    });
    const healthBar = previewFrame.locator(".fg-preview-app__health-bar");
    await expect(healthBar).toHaveAttribute("aria-valuenow", "5");

    // Kill the existing single demo goblin (13, 8) and the placed one (15, 8) — the quest needs both.
    const enemyEntity = await previewFrame.evaluate(() => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.enemyEntity);
    await killEnemy(page, previewFrame, enemyEntity);
    const placedEnemyEntity = await previewFrame.evaluate(() => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      const [id] = gameWorld.enemyEntitiesByPlacementId.values();
      if (id === undefined) throw new Error("no placed enemy found");
      return id;
    });
    await killEnemy(page, previewFrame, placedEnemyEntity);

    // Walk onto whichever coin dropped last — triggers the graph's own
    // pickup:collected reaction: quest start + objective complete + a
    // real, table-driven heal.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowRight");

    await expect(healthBar).toHaveAttribute("aria-valuenow", String(HEAL_AMOUNT), { timeout: 3_000 });
    const questState = await previewFrame.evaluate((id) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      return gameWorld.world.get(gameWorld.playerEntity!, `Quest_${id}`);
    }, questId);
    expect(questState).toMatchObject({ completed: 1, obj0: 1 });

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);

    // --- Save the finished project as the flagship-demo fixture. ---
    const document = await page.evaluate(() => {
      const store = window.__forgeProjectStoreDebug;
      if (!store) throw new Error("__forgeProjectStoreDebug not present — is this a DEV build?");
      return store.getState().document;
    });
    const exportFile = { projectId: "flagship-demo", document };
    const here = dirname(fileURLToPath(import.meta.url));
    const outDir = join(here, "..", "..", "..", "fixtures", "projects", "flagship-demo");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "document.json"), JSON.stringify(exportFile, null, 2) + "\n");
  });
});

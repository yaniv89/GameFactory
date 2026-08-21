import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * docs/adr/0018's own M13 exit criterion: a real quest (start ->
 * objective -> complete, graph-authored) and a graph reading a real data
 * table row, both verified live in the preview, not asserted. The
 * mechanic reuses H1e's own pickup ("picking up the demo enemy's dropped
 * coin") as the trigger — mirroring `graphRuntimeMechanic.spec.ts`'s own
 * choreography for killing the enemy and picking up the coin — but drives
 * two new effects off it, entirely through the real UI: starting and
 * completing a quest's one objective, and healing the player by an amount
 * looked up from an authored data table row (proving the lookup is real,
 * not a fixed number: the table has two rows, and the graph's `key`
 * deliberately doesn't match the first one).
 *
 * The graph: core:onEvent(pickup:collected) -> core:questStart ->
 * core:questCompleteObjective -> core:setComponent(Health), with the
 * quest/objective ids and the table/column ids all real ids copied out of
 * QuestsPanel/DataTablesPanel/DataTableEditorDialog's own UI (the `fg-id-tag`
 * elements added alongside this spec — a real, previously-missing
 * affordance: before this, a table's and a column's own id were never
 * shown anywhere, so `core:lookupRow`'s `table`/`keyColumn` config
 * couldn't actually be authored by a person looking at the DataTablesPanel
 * UI alone). `core:getField` is used twice — once to pull the triggering
 * player entity off the event payload, once to pull the looked-up row's
 * `amount` field back out — so unlike `graphRuntimeMechanic.spec.ts`'s
 * "one node type per graph" convention, this spec disambiguates the two
 * instances positionally (`.first()`/`.last()`), relying on
 * `graph.nodes.push` (`projectStore.ts`) never reordering nodes: the
 * outline and the connect-picker's target list both always list nodes in
 * insertion order.
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

async function enemyAlive(previewFrame: Frame): Promise<boolean> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.isAlive(gameWorld.enemyEntity);
  });
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

async function setPlayerHealth(previewFrame: Frame, current: number, max: number): Promise<void> {
  await previewFrame.evaluate(
    ([c, m]) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      gameWorld.world.set(gameWorld.playerEntity!, "Health", { current: c, max: m });
      gameWorld.world.flush();
    },
    [current, max] as [number, number],
  );
}

test.describe("docs/adr/0018 M13: a real quest and a real data-table lookup, running in the real live preview", () => {
  test("a graph-authored quest completion and a data-table-driven heal both run for real on coin pickup", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.addInitScript(() => {
      (window as unknown as { __forgeTestDisableEnemyAggro: boolean }).__forgeTestDisableEnemyAggro = true;
    });

    await page.goto("/");

    // --- Author the quest (QuestsPanel), reading its real ids back out. ---
    const questsRegion = page.getByRole("region", { name: "Quests" });
    await questsRegion.getByRole("button", { name: "Create a quest" }).click();
    const questId = await questsRegion.locator(".fg-quests-list__header .fg-id-tag").innerText();
    await questsRegion.getByRole("button", { name: "Add objective" }).click();
    const objectiveId = await questsRegion.locator(".fg-quests-list__objective-row .fg-id-tag").innerText();

    // --- Author the data table (DataTablesPanel + DataTableEditorDialog),
    // importing two rows via CSV so the lookup below is a real match
    // against a specific key, not coincidentally "whatever's first". ---
    const tablesRegion = page.getByRole("region", { name: "Data Tables" });
    await tablesRegion.getByRole("button", { name: "Create a data table" }).click();
    const tableId = await tablesRegion.locator(".fg-graphs-list__row .fg-id-tag").innerText();
    await tablesRegion.getByRole("button", { name: "Open" }).click();

    const tableDialog = page.getByRole("dialog");
    await expect(tableDialog).toBeVisible();
    await tableDialog.getByLabel("Paste CSV to import").fill("id,amount\n1,10\n2,25");
    await tableDialog.getByRole("button", { name: "Import CSV" }).click();
    const columnRows = tableDialog.locator(".fg-data-table-editor__column-row");
    await expect(columnRows).toHaveCount(2);
    const keyColumnId = await columnRows.nth(0).locator(".fg-id-tag").innerText();
    const amountColumnId = await columnRows.nth(1).locator(".fg-id-tag").innerText();
    await tableDialog.getByLabel("Column name").first().click();
    await page.keyboard.press("Escape");
    await expect(tableDialog).toHaveCount(0);

    // --- Place the player (the default scene's own demo enemy needs no
    // placement — graphRuntimeMechanic.spec.ts's own convention). ---
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    const playerStartPoint = await screenPointForTile(page, PLAYER_START.x, PLAYER_START.y);
    await page.mouse.click(playerStartPoint.x, playerStartPoint.y);

    // --- Build the graph, entirely through the UI. ---
    const graphsRegion = page.getByRole("region", { name: "Graphs" });
    await graphsRegion.getByRole("button", { name: "Create a graph" }).click();
    await graphsRegion.getByRole("button", { name: "Open", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const palette = dialog.getByRole("complementary", { name: "Node palette" });
    const outline = dialog.getByRole("tree", { name: "Graph Outline" });

    async function addNode(paletteLabel: string): Promise<void> {
      await palette.getByRole("button", { name: paletteLabel }).click();
    }

    async function selectOutline(label: string, position: "only" | "first" | "last" = "only"): Promise<void> {
      const matches = outline.getByText(label);
      const target = position === "first" ? matches.first() : position === "last" ? matches.last() : matches;
      await target.click();
    }

    async function fillField(fieldLabel: string, value: string, blur = true): Promise<void> {
      const input = dialog.getByLabel(fieldLabel);
      await input.fill(value);
      if (blur) await input.blur();
    }

    // 1. On Event(pickup:collected)
    await addNode("On Event");
    await selectOutline("On Event");
    await fillField("Event name", "pickup:collected");

    // 2. Get Field A — pulls the triggering player entity off the payload.
    // Only one "Get Field" node exists yet, so no disambiguation is needed
    // here — added and configured before node 7 (Get Field B) ever exists.
    await addNode("Get Field");
    await selectOutline("Get Field");
    await fillField("Field name", "player");

    // 3. Start Quest
    await addNode("Start Quest");
    await selectOutline("Start Quest");
    await fillField("Quest ID", questId);

    // 4. Complete Objective — two config fields, one form, committed
    // together on the second field's blur.
    await addNode("Complete Objective");
    await selectOutline("Complete Objective");
    await fillField("Quest ID", questId, false);
    await fillField("Objective ID", objectiveId);

    // 5. Constant (number) — the lookup key. `2`, not `1`: proves the
    // graph performs a real keyed lookup rather than always reading
    // whichever row happens to be first.
    await addNode("Constant (number)");
    await selectOutline("Constant (number)");
    await fillField("Value", "2");

    // 6. Lookup Row
    await addNode("Lookup Row");
    await selectOutline("Lookup Row");
    await fillField("Table ID", tableId, false);
    await fillField("Key column", keyColumnId);

    // 7. Get Field B — pulls `amount` back out of the looked-up row. A
    // second "Get Field" node now exists; every outline/wire reference to
    // it from here on uses `.last()`, and every reference to node 2 above
    // uses `.first()` — insertion order (`graph.nodes.push`,
    // `projectStore.ts`) keeps both stable for the rest of this spec.
    await addNode("Get Field");
    await selectOutline("Get Field", "last");
    await fillField("Field name", amountColumnId);

    // 8. Set Field — wraps the healed amount into a `{current: n}` patch.
    await addNode("Set Field");
    await selectOutline("Set Field");
    await fillField("Field name", "current");

    // 9. Set Component(Health)
    await addNode("Set Component");
    await selectOutline("Set Component");
    await fillField("Component", "Health");

    async function wire(
      fromLabel: string,
      fromPosition: "only" | "first" | "last",
      outputSocket: string,
      toLabel: string,
      toPosition: "only" | "first" | "last",
    ): Promise<void> {
      await selectOutline(fromLabel, fromPosition);
      await dialog.getByRole("button", { name: new RegExp(`^Output: ${outputSocket} \\(`) }).click();
      const targets = dialog.getByRole("button", { name: new RegExp(`^${toLabel} \\(`) });
      const target = toPosition === "first" ? targets.first() : toPosition === "last" ? targets.last() : targets;
      await target.click();
    }

    // Flow chain.
    await wire("On Event", "only", "flow", "Start Quest.flow", "only");
    await wire("Start Quest", "only", "flow", "Complete Objective.flow", "only");
    await wire("Complete Objective", "only", "flow", "Set Component.flow", "only");

    // The triggering player entity, fanned out to every node that needs it
    // — a data output can feed more than one input (`graphValidation.ts`'s
    // own `isValidConnection`, unlike a flow output).
    await wire("On Event", "only", "payload", "Get Field.object", "first");
    await wire("Get Field", "first", "value", "Start Quest.entity", "only");
    await wire("Get Field", "first", "value", "Complete Objective.entity", "only");
    await wire("Get Field", "first", "value", "Set Component.entity", "only");

    // The table lookup itself.
    await wire("Constant (number)", "only", "value", "Lookup Row.key", "only");
    await wire("Lookup Row", "only", "row", "Get Field.object", "last");
    await wire("Get Field", "last", "value", "Set Field.value", "only");
    await wire("Set Field", "only", "object", "Set Component.value", "only");

    await expect(dialog.locator(".react-flow__edge")).toHaveCount(11);

    await dialog.getByLabel("Name").first().click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // --- Run it for real. ---
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

    // Damage the player first — healing to 25 from 100 would be
    // indistinguishable from "did nothing in particular".
    await setPlayerHealth(previewFrame, 5, 100);
    const healthBar = previewFrame.locator(".fg-preview-app__health-bar");
    await expect(healthBar).toHaveAttribute("aria-valuenow", "5");

    // Kill the demo enemy for its coin drop (graphRuntimeMechanic.spec.ts's
    // own choreography and its own stated timing margin).
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);

    for (let attempt = 0; attempt < 6 && (await enemyAlive(previewFrame)); attempt++) {
      await repositionPlayerNextToEnemy(previewFrame);
      await page.keyboard.press(" ");
      await page.waitForTimeout(550);
    }
    expect(await enemyAlive(previewFrame)).toBe(false);

    // Walk east onto the dropped coin — triggers a real pickup:collected
    // event, reaching the graph built above.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");

    // The looked-up amount (row key `2` -> 25), not the other row's 10 and
    // not the player's max — proves the graph read a real, specific table
    // row rather than a hardcoded number.
    await expect(healthBar).toHaveAttribute("aria-valuenow", "25", { timeout: 3_000 });

    // The quest itself really started and completed — read directly off
    // the player's own `Quest_<id>` ECS component, not inferred from the
    // heal alone.
    const questState = await previewFrame.evaluate((id) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      return gameWorld.world.get(gameWorld.playerEntity!, `Quest_${id}`);
    }, questId);
    expect(questState).toMatchObject({ active: 0, completed: 1, obj0: 1 });

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});

import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * docs/adr/0018 Decision 2's own M13 exit criterion: a real branching
 * dialogue, authored entirely through `DialogueTreeEditorDialog` (M10) —
 * not a single choiceless line (`walkableDemo.spec.ts`/`moduleGating.spec.ts`
 * already prove that path) — actually branches in the live preview when a
 * real choice button is clicked.
 *
 * The tree: node 0 ("Want to see my wares?") offers two choices —
 * "Show me" (leads to node 1, a follow-up line with no choices of its own)
 * and "Never mind" (ends the dialogue immediately). Interacting twice with
 * the same NPC exercises both, proving the two different shapes
 * `dialogue:ended` can take in `PreviewApp.tsx` (see its
 * `justShownThisTurnRef` doc comment): ending because the current line
 * simply has no choices (the bubble should keep reading normally) versus
 * ending because a choice explicitly said so (the bubble should clear at
 * once, not linger for the usual `DIALOGUE_BUBBLE_MS`).
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 5, y: 8 };
const NPC_TILE = { x: 6, y: 8 }; // one tile east — well within INTERACT_RANGE (40 world units), matching moduleGating.spec.ts's own convention

const NODE_0 = { speaker: "Shopkeeper", text: "Want to see my wares?" };
const NODE_1 = { speaker: "Shopkeeper", text: "Here's what I've got: a sword and a shield." };
const CHOICE_CONTINUE = "Show me";
const CHOICE_END = "Never mind";

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

function getPreviewFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes("preview.html"));
  if (!frame) throw new Error("preview iframe not found among page.frames()");
  return frame;
}

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: { playerEntity: number | undefined } | null;
  };
}

test.describe("docs/adr/0018 M13: a real branching dialogue, running in the real live preview", () => {
  test("a choice built through DialogueTreeEditorDialog actually branches the conversation in the live preview", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");

    // --- Place the NPC and give it its opening line. ---
    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "NPC" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);

    const speakerField = page.getByLabel("Speaker");
    await expect(speakerField).toBeVisible();
    await speakerField.fill(NODE_0.speaker);
    const lineField = page.getByLabel("Line");
    await lineField.fill(NODE_0.text);
    await lineField.blur();

    // --- Build the branch, entirely through DialogueTreeEditorDialog. ---
    await page.getByRole("button", { name: "Edit branching dialogue…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const outline = dialog.getByRole("tree", { name: "Dialogue Outline" });

    // Node 0 already exists (the quick-form line above) and is selected by
    // default. Add node 1 — DialogueTreeEditorDialog auto-selects it.
    await dialog.getByRole("button", { name: "Add line" }).click();
    await dialog.getByLabel("Speaker", { exact: true }).fill(NODE_1.speaker);
    await dialog.getByLabel("Line", { exact: true }).fill(NODE_1.text);
    await dialog.getByLabel("Line", { exact: true }).blur();

    // Back to node 0 (the outline's first item — insertion order, never
    // reordered by anything this spec does) to author its two choices.
    await outline.getByRole("treeitem").first().click();

    // Choice A: "Show me" -> node 1. Configured immediately after being
    // added, before the second choice exists, so `getByLabel` needs no
    // `.last()` disambiguation here.
    await dialog.getByRole("button", { name: "Add choice" }).click();
    await dialog.getByLabel("Choice text").fill(CHOICE_CONTINUE);
    await dialog.getByLabel("Choice text").blur();
    await dialog.getByLabel("Leads to").selectOption("1");

    // Choice B: "Never mind" -> ends the dialogue (`addDialogueChoice`'s
    // own default `next`, left untouched). Two "Choice text"/"Leads to"
    // fields now exist (one per choice) — `.last()` reaches the one just
    // added, the same add-then-immediately-configure interleaving used
    // above, extended with positional disambiguation now that a second
    // same-labeled row exists.
    await dialog.getByRole("button", { name: "Add choice" }).click();
    await dialog.getByLabel("Choice text").last().fill(CHOICE_END);
    await dialog.getByLabel("Choice text").last().blur();

    // Real edges landed in the real store, not just component state:
    // node 0 now shows two configured choice rows.
    await expect(dialog.locator(".fg-dialogue-editor__choice-row")).toHaveCount(2);

    await dialog.getByLabel("Choice text").last().click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // --- Run it for real: open the preview, talk to the NPC, branch. ---
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

    const bubble = previewFrame.locator(".fg-preview-app__dialogue");
    const choices = previewFrame.locator(".fg-preview-app__dialogue-choice");

    // Round 1: open the conversation, see both real choice buttons.
    await page.keyboard.press("e");
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    await expect(bubble.locator(".fg-preview-app__dialogue-speaker")).toHaveText(NODE_0.speaker);
    await expect(bubble.locator(".fg-preview-app__dialogue-text")).toHaveText(NODE_0.text);
    await expect(choices).toHaveCount(2);
    await expect(choices.filter({ hasText: CHOICE_CONTINUE })).toBeVisible();
    await expect(choices.filter({ hasText: CHOICE_END })).toBeVisible();

    // Pick "Show me" -> node 1 has no choices of its own, so
    // `dialogue:shown` and `dialogue:ended` fire back to back for it
    // (case (a) in PreviewApp.tsx's own doc comment) — the bubble should
    // keep showing the new line, not vanish the instant it appears.
    await choices.filter({ hasText: CHOICE_CONTINUE }).click();
    await expect(bubble.locator(".fg-preview-app__dialogue-text")).toHaveText(NODE_1.text);
    await expect(choices).toHaveCount(0);

    // Round 2: re-interact (dialogue is inactive again — node 1 had no
    // choices, so it already self-ended) — starts fresh from node 0.
    await page.keyboard.press("e");
    await expect(bubble.locator(".fg-preview-app__dialogue-text")).toHaveText(NODE_0.text);
    await expect(choices).toHaveCount(2);

    // Pick "Never mind" -> `next === -1`, so `dialogue:choose`'s handler
    // calls `endDialogue()` directly, with no `dialogue:shown` earlier in
    // this call chain (case (b)) — the bubble must clear right away, well
    // inside the ordinary `DIALOGUE_BUBBLE_MS` (3500ms) timeout window, or
    // this assertion's own much shorter timeout catches the regression.
    await choices.filter({ hasText: CHOICE_END }).click();
    await expect(bubble).toBeHidden({ timeout: 500 });

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});

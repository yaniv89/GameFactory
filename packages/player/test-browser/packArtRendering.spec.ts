import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

/** Standard PNG "Paeth" un-filter predictor (the PNG spec's own reference algorithm). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * The mean RGBA of every pixel a `page.screenshot({ clip })` PNG encodes.
 * `page.screenshot` (a real browser compositor capture) is used instead
 * of `ctx.drawImage(canvas, ...)` + `getImageData` from inside the page:
 * this build's `RenderHost` runs a live WebGL ticker with no
 * `preserveDrawingBuffer`, and reading the canvas element directly from
 * JS can race the browser's own backbuffer clear between presented
 * frames — confirmed the hard way (a real "GPU stall due to ReadPixels"
 * driver warning, and a `drawImage` read that came back solid black even
 * while a full-page screenshot of the exact same moment showed the real,
 * correctly-textured grass tile). `packages/editor/test-browser/packRendering.spec.ts`
 * sidesteps this by forcing a synchronous `app.renderer.render(app.stage)`
 * right before sampling — not available here, since that debug hook is
 * DEV-gated and stripped from a real export (`render.ts`'s own
 * `__forgePlayerDebug` doc comment). A compositor screenshot has no such
 * race. Averaged over a small clip region rather than one pixel for the
 * same reason that spec's own doc comment gives for its single-point
 * sample being more robust than comparing two — one raw grass-texture
 * pixel can land on a blade highlight or shadow; the *mean* of a small
 * patch is what the pack PNG's own known mean color is actually
 * comparable against.
 *
 * A real (not simplified/approximated) PNG decoder — no new dependency:
 * `node:zlib` is a Node built-in, and 8-bit RGB/RGBA scanline
 * un-filtering (None/Sub/Up/Average/Paeth) is the PNG spec's own small,
 * well-defined algorithm, not something worth pulling a package in for.
 */
function readAveragePixelPng(png: Buffer): readonly number[] {
  let offset = 8; // past the fixed 8-byte PNG signature.
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idatChunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png.readUInt8(dataStart + 8);
      colorType = png.readUInt8(dataStart + 9);
    } else if (type === "IDAT") {
      idatChunks.push(png.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // + 4 for the trailing CRC.
  }
  if (bitDepth !== 8) throw new Error(`readAveragePixelPng: expected an 8-bit PNG, got bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : undefined;
  if (!channels) throw new Error(`readAveragePixelPng: unsupported PNG color type ${colorType} (expected RGB or RGBA)`);

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]!;
    rawOffset += 1;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOffset + x]!;
      const a = x >= channels ? pixels[y * stride + x - channels]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const c = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + Math.floor((a + b) / 2);
          break;
        case 4:
          value = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`readAveragePixelPng: unsupported PNG filter type ${filterType}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
    rawOffset += stride;
  }

  const sums = new Array<number>(channels).fill(0);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    for (let c = 0; c < channels; c++) sums[c]! += pixels[i * channels + c]!;
  }
  const mean = sums.map((sum) => sum / pixelCount);
  if (channels === 3) mean.push(255);
  return mean;
}

/**
 * K1 Phase 2b: the standalone exported game's own real Art Pack
 * rendering, proven the same way `packages/editor/test-browser/packRendering.spec.ts`
 * already proves it for the in-editor canvas — with `@forge-fixtures/starter-pack`
 * active and a Grass tile painted, the real `forge export` output must
 * render that pack's own `tilesets/outdoor-base.png`, not `tilePalette.ts`'s
 * flat-color fallback. Before this task, `packages/player` never wired
 * `@forge/art-pack` at all (confirmed by grep — zero matches), so every
 * exported build rendered flat placeholder shapes regardless of which
 * pack a project had active; this is the regression test that would fail
 * if that gap came back.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "dist", "index.js");

const GRID_WIDTH = 20;
const GRID_HEIGHT = 15;
const TILE_SIZE = 32;
const GRASS_TILE_ID = 1;
const GRASS_TILE = { x: 10, y: 7 }; // clear of (0,0)'s player-start and any HUD chrome.

const VIEWPORT = { width: 1280, height: 720 };

// Same real, measured mean/tolerance packRendering.spec.ts's own doc
// comment computes directly from fixtures/packs/starter-pack/tilesets/outdoor-base.png
// — not guessed, and not re-derived here since it's the exact same PNG.
const GRASS_TILE_MEAN_RGB = [68, 137, 31];
const GRASS_TILE_TOLERANCE = 30;

function tileCenterWorld(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

/** Mirrors `@forge/render-2d`'s own `Camera.worldToScreen` exactly — `render.ts`'s boot centers the camera on the whole (fixed-size) grid and fits it to the viewport, so this is fully determined by VIEWPORT, GRID_WIDTH, GRID_HEIGHT, and TILE_SIZE alone. */
function worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
  const worldWidth = GRID_WIDTH * TILE_SIZE;
  const worldHeight = GRID_HEIGHT * TILE_SIZE;
  const zoom = Math.min(VIEWPORT.width / worldWidth, VIEWPORT.height / worldHeight);
  const cameraX = worldWidth / 2;
  const cameraY = worldHeight / 2;
  return {
    x: VIEWPORT.width / 2 + (worldX - cameraX) * zoom,
    y: VIEWPORT.height / 2 + (worldY - cameraY) * zoom,
  };
}

let outDir: string;

test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "forge-player-pack-art-"));

  const tiles = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
  tiles[GRASS_TILE.y * GRID_WIDTH + GRASS_TILE.x] = GRASS_TILE_ID;

  const projectInput = {
    projectId: "pack-art-check",
    buildId: "pack-art-check-build",
    schemaVersion: 1,
    engineVersion: "0.0.0",
    activePack: "@forge-fixtures/starter-pack",
    scenes: [
      {
        id: "s1",
        name: "grass check",
        tiles,
        entities: [{ id: "e1", prefabId: "player-start", tileX: 0, tileY: 0 }],
      },
    ],
    installedModules: [],
    dataTables: {},
    startSceneId: "s1",
  };

  const projectPath = join(outDir, "project.json");
  writeFileSync(projectPath, JSON.stringify(projectInput));

  execFileSync("node", [CLI_ENTRY, "export", "--project", projectPath, "--out", join(outDir, "build")], { stdio: "inherit" });
});

test.afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test.describe("K1 Phase 2b: Art Pack rendering in the real exported/standalone game", () => {
  test("with a pack active, a painted Grass tile renders that pack's own textured tile, not the flat-color fallback", async ({ browser }) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("http://") || url.startsWith("https://")) externalRequests.push(url);
    });

    const indexUrl = pathToFileURL(join(outDir, "build", "index.html")).href;
    await page.goto(indexUrl);

    const canvas = page.locator("#forge-player-canvas");
    await expect(canvas).toBeVisible();

    // A 20x20 patch centered on the tile, well inside its 48x48 on-screen
    // bounds at this viewport's zoom (min(1280/640, 720/480) = 1.5×
    // TILE_SIZE) — clear of any neighboring tile's edge.
    const grassWorld = tileCenterWorld(GRASS_TILE.x, GRASS_TILE.y);
    const point = worldToScreen(grassWorld.x, grassWorld.y);
    const patchSize = 20;
    const clip = { x: Math.floor(point.x - patchSize / 2), y: Math.floor(point.y - patchSize / 2), width: patchSize, height: patchSize };

    // Polled, not a single fixed-delay sample: this build's boot (QuickJS
    // WASM instantiation, the pack's own async fetch/decode/slice) and
    // the WebGL ticker's own frame timing both vary under load — running
    // this spec alongside a sibling test with `fullyParallel` (two real
    // Chromium instances sharing one GPU) reproduced a stale/still-clearing
    // frame sampling as near-black well past a fixed 1500ms wait. Retries
    // the same real screenshot-based sample (this file's own doc comment
    // on why a screenshot, not `ctx.drawImage`) until it's within
    // tolerance or the timeout is spent — a real boot only ever needs
    // this once it's actually ready, not a padded worst-case guess.
    let pixel: readonly number[] = [];
    await expect
      .poll(
        async () => {
          const png = await page.screenshot({ clip });
          pixel = readAveragePixelPng(png);
          return Math.max(...[0, 1, 2].map((channel) => Math.abs(pixel[channel]! - GRASS_TILE_MEAN_RGB[channel]!)));
        },
        { timeout: 10_000 },
      )
      .toBeLessThanOrEqual(GRASS_TILE_TOLERANCE);

    expect(pixel[3]).toBe(255);

    expect(consoleErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await page.close();
  });
});

// A real Node script, not vitest — same reason packages/player's own
// smoke test is one: adding vitest here would need vite transitively,
// which hits the pnpm trust-policy gate documented in
// pnpm-workspace.yaml's own trustPolicyExclude entry (issue #6). This
// proves `forge export` end to end, twice: once against a minimal inline
// fixture (fast, isolates the mechanism itself), and once against the
// real, checked-in fixtures/projects/starter-rpg/project.json (M6 Phase
// 5f) — so that fixture is actually exercised by CI on every push, not
// just sitting there unverified. Both prove the same real claims: no
// pre-computed guest bundle text in the project file (runExport resolves
// @forge/dialogue's own dist/guest-bundle.js itself), a real
// file://-loadable dist directory out, with a real LICENSES.txt.
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport } from "../commands/export.js";
import { findRepoRoot } from "../repoRoot.js";

const REPO_ROOT = findRepoRoot();

function buildFixtureProjectData(): unknown {
  const tiles = new Array(300).fill(1);
  return {
    projectId: "cli-smoke-test-project",
    buildId: "cli-smoke-test-build",
    schemaVersion: 1,
    engineVersion: "0.0.0-cli-smoke-test",
    scenes: [
      {
        id: "scene-1",
        name: "CLI Smoke Test Scene",
        tiles,
        entities: [{ id: "player", kind: "player-start", tileX: 2, tileY: 2 }],
      },
    ],
    installedModules: [{ name: "@forge/dialogue", version: "1.0.0", config: { trees: [] } }],
    startSceneId: "scene-1",
  };
}

function assertRealFileUrlLoadable(outDir: string, label: string): void {
  const indexPath = join(outDir, "index.html");
  assert.ok(existsSync(indexPath), `[${label}] expected index.html in the export output`);
  const html = readFileSync(indexPath, "utf8");

  // The actual file:// claim: no separate <script src="..."> for the
  // app's own JS — that's exactly what Chrome's CORS-on-file://
  // restriction blocks (packages/player/scripts/inline-bundle.mjs's own
  // doc comment). An inline <script type="module"> with real,
  // substantial content is what proves inlining actually ran, not just
  // that some HTML got copied.
  assert.ok(!/<script[^>]*\ssrc="/.test(html), `[${label}] expected no separate <script src=...> in the exported index.html — must be inlined for file://`);
  assert.ok(/<script type="module">[\s\S]{10000,}<\/script>/.test(html), `[${label}] expected a real, substantial inline module script`);

  const licensesPath = join(outDir, "LICENSES.txt");
  assert.ok(existsSync(licensesPath), `[${label}] expected LICENSES.txt in the export output`);
  const licenses = readFileSync(licensesPath, "utf8");
  assert.ok(licenses.includes("MIT"), `[${label}] expected at least the MIT license section (pixi.js and others are MIT)`);
  assert.ok(licenses.includes("quickjs-wasmfile-release-sync"), `[${label}] expected the quickjs wasmfile package to be listed`);
}

function main(): void {
  // Pass 1: minimal inline fixture.
  const workDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-"));
  try {
    const projectPath = join(workDir, "project.json");
    const outDir = join(workDir, "out");
    writeFileSync(projectPath, JSON.stringify(buildFixtureProjectData(), null, 2));
    runExport({ projectPath, outDir });
    assertRealFileUrlLoadable(outDir, "inline fixture");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  // Pass 2: the real, checked-in starter-rpg fixture (M6 Phase 5f) — two
  // rooms separated by a wall with a doorway, a player start, and a
  // talking NPC (the same layout
  // packages/editor/test-browser/walkableDemo.spec.ts already proves
  // walkable through the real editor UI). This is CI's only real
  // exercise of that fixture file, so a bug in it fails a push, not just
  // sitting there silently rotting.
  const starterRpgDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-starter-rpg-"));
  try {
    const outDir = join(starterRpgDir, "out");
    runExport({ projectPath: join(REPO_ROOT, "fixtures/projects/starter-rpg/project.json"), outDir });
    assertRealFileUrlLoadable(outDir, "starter-rpg");
  } finally {
    rmSync(starterRpgDir, { recursive: true, force: true });
  }

  console.log("cli export smoke-test: PASS");
}

main();

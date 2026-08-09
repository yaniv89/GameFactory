// A real Node script, not vitest — same reason packages/player's own
// smoke test is one: adding vitest here would need vite transitively,
// which hits the pnpm trust-policy gate documented in
// pnpm-workspace.yaml's own trustPolicyExclude entry (issue #6). This
// proves `forge export` end to end: a real PlayerProjectData JSON file
// in, a real file://-loadable dist directory out, with a real
// LICENSES.txt.
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runExport } from "../commands/export.js";
import { findRepoRoot } from "../repoRoot.js";

const REPO_ROOT = findRepoRoot();
const require = createRequire(join(REPO_ROOT, "packages/cli/package.json"));

function readDialogueGuestBundle(): string {
  const path = require.resolve("@forge/dialogue/dist/guest-bundle.js", { paths: [join(REPO_ROOT, "packages/cli")] });
  return readFileSync(path, "utf8");
}

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
    installedModules: [
      {
        name: "@forge/dialogue",
        version: "1.0.0",
        config: { trees: [] },
        guestBundleSource: readDialogueGuestBundle(),
      },
    ],
    startSceneId: "scene-1",
  };
}

function main(): void {
  const workDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-"));
  const projectPath = join(workDir, "playerProjectData.json");
  const outDir = join(workDir, "out");
  writeFileSync(projectPath, JSON.stringify(buildFixtureProjectData(), null, 2));

  try {
    runExport({ projectPath, outDir });

    const indexPath = join(outDir, "index.html");
    assert.ok(existsSync(indexPath), "expected index.html in the export output");
    const html = readFileSync(indexPath, "utf8");

    // The actual file:// claim: no separate <script src="..."> for the
    // app's own JS — that's exactly what Chrome's CORS-on-file://
    // restriction blocks (packages/player/scripts/inline-bundle.mjs's own
    // doc comment). An inline <script type="module"> with real,
    // substantial content is what proves inlining actually ran, not just
    // that some HTML got copied.
    assert.ok(!/<script[^>]*\ssrc="/.test(html), "expected no separate <script src=...> in the exported index.html — must be inlined for file://");
    assert.ok(/<script type="module">[\s\S]{10000,}<\/script>/.test(html), "expected a real, substantial inline module script");

    const licensesPath = join(outDir, "LICENSES.txt");
    assert.ok(existsSync(licensesPath), "expected LICENSES.txt in the export output");
    const licenses = readFileSync(licensesPath, "utf8");
    assert.ok(licenses.includes("MIT"), "expected at least the MIT license section (pixi.js and others are MIT)");
    assert.ok(licenses.includes("quickjs-wasmfile-release-sync"), "expected the quickjs wasmfile package to be listed");

    console.log("cli export smoke-test: PASS");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();

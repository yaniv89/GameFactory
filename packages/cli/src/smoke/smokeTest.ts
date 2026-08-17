// A real Node script, not vitest — same reason packages/player's own
// smoke test is one: adding vitest here would need vite transitively,
// which hits the pnpm trust-policy gate documented in
// pnpm-workspace.yaml's own trustPolicyExclude entry (issue #6). This
// proves `forge export` end to end: once against a minimal inline
// fixture (fast, isolates the mechanism itself), once against the real,
// checked-in fixtures/projects/starter-rpg/project.json (M6 Phase 5f) —
// so that fixture is actually exercised by CI on every push, not just
// sitting there unverified — and once against a marketplace-sourced
// module whose guest bundle is fetched over a real local HTTP server,
// proving the hash-verified fetch path actually resolves real bytes into
// a real build (and separately, that a tampered/mismatched hash is
// refused, not silently trusted). The first two prove: no pre-computed
// guest bundle text in the project file for a first-party module
// (runExport resolves @forge/dialogue's own dist/guest-bundle.js itself),
// a real file://-loadable dist directory out, with a real LICENSES.txt.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
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

/** A real local HTTP server serving fixed bytes at one URL — not a mocked `fetch`, the same "real, not mocked" standard this whole file already holds itself to for everything else. `port: 0` lets the OS pick a free port. */
async function withFakeBundleServer(bundleSource: string, run: (bundleUrl: string) => Promise<void>): Promise<void> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(bundleSource);
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", () => resolve()).on("error", reject));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("cli smoke test: the fake bundle server didn't report a real address.");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/bundle.js`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function main(): Promise<void> {
  // Pass 1: minimal inline fixture.
  const workDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-"));
  try {
    const projectPath = join(workDir, "project.json");
    const outDir = join(workDir, "out");
    writeFileSync(projectPath, JSON.stringify(buildFixtureProjectData(), null, 2));
    await runExport({ projectPath, outDir });
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
    await runExport({ projectPath: join(REPO_ROOT, "fixtures/projects/starter-rpg/project.json"), outDir });
    assertRealFileUrlLoadable(outDir, "starter-rpg");
  } finally {
    rmSync(starterRpgDir, { recursive: true, force: true });
  }

  // Pass 3: a marketplace-sourced module's guest bundle, fetched over a
  // real local HTTP server and hash-verified — proving the resolution
  // path D1 added actually reaches real bytes and embeds them, and
  // separately, that a hash mismatch is refused rather than silently
  // trusted (a compromised/misconfigured CDN must never succeed quietly).
  const marketplaceMarker = "FORGE_CLI_SMOKE_MARKETPLACE_MARKER_9f3a1c";
  const fakeGuestBundleSource = `// fake marketplace guest bundle\n__forge_registerModule({ setup: function (ctx) {} }); // ${marketplaceMarker}\n`;
  const fakeGuestBundleHashHex = createHash("sha256").update(Buffer.from(fakeGuestBundleSource, "utf8")).digest("hex").toUpperCase();

  await withFakeBundleServer(fakeGuestBundleSource, async (bundleUrl) => {
    const marketplaceDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-marketplace-"));
    try {
      const projectPath = join(marketplaceDir, "project.json");
      const outDir = join(marketplaceDir, "out");
      const fixture = buildFixtureProjectData() as Record<string, unknown>;
      fixture.installedModules = [
        { name: "@acme/loot-tables", version: "1.2.0", config: {}, guestBundleUrl: bundleUrl, guestBundleSha256Hex: fakeGuestBundleHashHex },
      ];
      writeFileSync(projectPath, JSON.stringify(fixture, null, 2));
      await runExport({ projectPath, outDir });
      assertRealFileUrlLoadable(outDir, "marketplace module");
      const html = readFileSync(join(outDir, "index.html"), "utf8");
      assert.ok(html.includes(marketplaceMarker), "expected the marketplace module's real, fetched guest bundle source to be embedded in the export output");
    } finally {
      rmSync(marketplaceDir, { recursive: true, force: true });
    }

    const mismatchDir = mkdtempSync(join(tmpdir(), "forge-cli-smoke-marketplace-badhash-"));
    try {
      const projectPath = join(mismatchDir, "project.json");
      const outDir = join(mismatchDir, "out");
      const fixture = buildFixtureProjectData() as Record<string, unknown>;
      fixture.installedModules = [
        { name: "@acme/loot-tables", version: "1.2.0", config: {}, guestBundleUrl: bundleUrl, guestBundleSha256Hex: "0".repeat(64) },
      ];
      writeFileSync(projectPath, JSON.stringify(fixture, null, 2));
      await assert.rejects(
        () => runExport({ projectPath, outDir }),
        /does not match its published hash/,
        "expected runExport to refuse a guest bundle whose fetched bytes don't match its published hash",
      );
    } finally {
      rmSync(mismatchDir, { recursive: true, force: true });
    }
  });

  console.log("cli export smoke-test: PASS");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

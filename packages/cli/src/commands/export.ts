import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { validateArtPackManifest } from "@forge/art-pack";
import type { PlayerPackData, PlayerProjectData } from "@forge/player";
import { toExportProjectInput, type ExportInstalledModuleInput, type ExportProjectInput, type ProjectDocument } from "@forge/project-export";
import { findRepoRoot } from "../repoRoot.js";

const REPO_ROOT = findRepoRoot();
const PLAYER_DIR = join(REPO_ROOT, "packages/player");
const ALLOWLIST_PATH = join(REPO_ROOT, "tools/security/licenses.json");
const FIXTURE_PACKS_DIR = join(REPO_ROOT, "fixtures/packs");

// ExportProjectInput's canonical definition lives in @forge/project-export
// (docs/adr/0009) — re-exported here so existing callers of this module
// that import the type from `packages/cli` keep working.
export type { ExportProjectInput };

/**
 * What `--document` accepts: the editor's own `ProjectDocument` (the
 * "Export Project" toolbar button downloads exactly this shape,
 * unmodified) plus the `projectId` `toExportProjectInput` needs and
 * `ProjectDocument` itself doesn't carry. This is the real, editor-
 * authored counterpart to `--project`'s hand-authored `ExportProjectInput`
 * fixtures (docs/adr/0009) — not docs/SPEC.md Section 7's much larger
 * on-disk format, see that ADR for why.
 */
export interface ProjectDocumentExportFile {
  readonly projectId: string;
  readonly document: ProjectDocument;
}

export interface ExportOptions {
  /**
   * Path to an `ExportProjectInput` JSON file — see
   * packages/player/src/playerProjectData.ts for the field shapes.
   * Mutually exclusive with `documentPath`. `fixtures/projects/*` are
   * hand-authored files in this shape.
   */
  readonly projectPath?: string;
  /**
   * Path to a `ProjectDocumentExportFile` JSON file — what the editor's
   * "Export Project" button downloads for a real, in-progress project.
   * Mutually exclusive with `projectPath`.
   */
  readonly documentPath?: string;
  readonly outDir: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateExportProjectInput(value: unknown, sourcePath: string): asserts value is ExportProjectInput {
  const fail = (reason: string): never => {
    throw new Error(`forge export: "${sourcePath}" is not a valid project file — ${reason}`);
  };
  if (typeof value !== "object" || value === null) fail("expected a JSON object");
  const data = value as Record<string, unknown>;
  for (const field of ["projectId", "buildId", "engineVersion", "startSceneId"]) {
    if (typeof data[field] !== "string" || data[field] === "") fail(`"${field}" must be a non-empty string`);
  }
  if (typeof data.schemaVersion !== "number") fail('"schemaVersion" must be a number');
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) fail('"scenes" must be a non-empty array');
  if (!Array.isArray(data.installedModules)) fail('"installedModules" must be an array');
  const scenes = data.scenes as Array<Record<string, unknown>>;
  for (const scene of scenes) {
    if (typeof scene.id !== "string" || scene.id === "") fail("every scene needs a non-empty string id");
    if (!Array.isArray(scene.tiles) || scene.tiles.length !== 300) {
      fail(`scene "${String(scene.id)}" must have exactly 300 tiles (20x15 grid, gridConstants.ts), got ${Array.isArray(scene.tiles) ? scene.tiles.length : typeof scene.tiles}`);
    }
    if (!Array.isArray(scene.entities)) fail(`scene "${String(scene.id)}" is missing "entities"`);
  }
  if (!scenes.some((scene) => scene.id === data.startSceneId)) {
    fail(`"startSceneId" (${String(data.startSceneId)}) does not match any scene id`);
  }
  // docs/adr/0018 Decision 3: optional, defaulting to `{}` in
  // resolveExportProjectInput below — an existing hand-authored
  // ExportProjectInput fixture written before data tables existed has no
  // tables to declare and keeps working unchanged, the same
  // optional-with-default treatment `ModuleBridgeOptions.dataTables?` gets.
  if (data.dataTables !== undefined) {
    if (!isPlainObject(data.dataTables)) {
      fail('"dataTables", if present, must be an object mapping table id to an array of row objects');
    }
    const dataTables = data.dataTables as Record<string, unknown>;
    for (const [tableId, rows] of Object.entries(dataTables)) {
      if (!Array.isArray(rows) || !rows.every((row) => isPlainObject(row))) {
        fail(`data table "${tableId}" must be an array of plain row objects`);
      }
    }
  }
  const modules = data.installedModules as Array<Record<string, unknown>>;
  for (const installedModule of modules) {
    for (const field of ["name", "version"]) {
      if (typeof installedModule[field] !== "string" || installedModule[field] === "") {
        fail(`installed module is missing a non-empty string "${field}"`);
      }
    }
    if (typeof installedModule.config !== "object" || installedModule.config === null) {
      fail(`installed module "${String(installedModule.name)}" is missing a "config" object`);
    }
    // guestBundleUrl/guestBundleSha256Hex are optional — absent for a
    // first-party module (resolved from local node_modules instead) —
    // but always paired when present, since fetchGuestBundle below can
    // never verify a URL's bytes without the hash to check them against.
    const hasBundleUrl = installedModule.guestBundleUrl !== undefined;
    const hasBundleHash = installedModule.guestBundleSha256Hex !== undefined;
    if (hasBundleUrl !== hasBundleHash) {
      fail(`installed module "${String(installedModule.name)}" has "guestBundleUrl" without "guestBundleSha256Hex" (or vice versa) — both or neither.`);
    }
    if (hasBundleUrl && (typeof installedModule.guestBundleUrl !== "string" || installedModule.guestBundleUrl === "")) {
      fail(`installed module "${String(installedModule.name)}"'s "guestBundleUrl" must be a non-empty string`);
    }
    if (hasBundleHash && (typeof installedModule.guestBundleSha256Hex !== "string" || installedModule.guestBundleSha256Hex === "")) {
      fail(`installed module "${String(installedModule.name)}"'s "guestBundleSha256Hex" must be a non-empty string`);
    }
  }
}

/** Resolves `<moduleName>/dist/guest-bundle.js` from the player package's own node_modules — see `ExportProjectInput`'s doc comment for why this isn't pre-supplied in the project file. */
function readModuleGuestBundle(moduleName: string): string {
  const require = createRequire(join(PLAYER_DIR, "package.json"));
  let path: string;
  try {
    path = require.resolve(`${moduleName}/dist/guest-bundle.js`);
  } catch (err) {
    throw new Error(
      `forge export: could not resolve "${moduleName}/dist/guest-bundle.js" — is it installed as a dependency of packages/player, and has its own \`build\` script run? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return readFileSync(path, "utf8");
}

/** Reads an installed package's own declared version from its `package.json`, resolved from `packages/player`'s `node_modules` — the same place `readModuleGuestBundle` already resolves from, and the "local/workspace-resolved version of a future registry-backed resolution" `ExportProjectInput`'s own doc comment names as the intended migration path (docs/adr/0009 decision 3). */
function resolvePackageVersion(packageName: string): string {
  const require = createRequire(join(PLAYER_DIR, "package.json"));
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${packageName}/package.json`);
  } catch (err) {
    throw new Error(
      `forge export: could not resolve "${packageName}/package.json" — is it installed as a dependency of packages/player? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const version = (JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: unknown }).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`forge export: "${pkgJsonPath}" has no valid "version" field.`);
  }
  return version;
}

/**
 * Fetches a marketplace-installed module's real, published guest bundle
 * over HTTP and verifies the bytes against the hash published alongside
 * it — the CLI/build-time equivalent of the Subresource Integrity check
 * the runtime already gets for browser-side dependency loading
 * (`DependencyResolver.cs`), since there's no browser SRI mechanism to
 * lean on here. A hash mismatch is treated as fatal, not a warning: this
 * bundle is about to be embedded into a build and run inside the sandbox,
 * so serving stale/tampered bytes from a compromised or misconfigured CDN
 * must never silently succeed.
 */
async function fetchGuestBundle(url: string, expectedSha256Hex: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`forge export: could not reach the guest bundle URL "${url}" (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!response.ok) {
    throw new Error(`forge export: fetching the guest bundle from "${url}" failed with HTTP ${response.status} ${response.statusText}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHex = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (actualHex !== expectedSha256Hex.toUpperCase()) {
    throw new Error(
      `forge export: the guest bundle fetched from "${url}" does not match its published hash (expected ${expectedSha256Hex}, got ${actualHex}) — refusing to trust it.`,
    );
  }
  return bytes.toString("utf8");
}

async function resolveGuestBundleSource(installedModule: ExportInstalledModuleInput): Promise<string> {
  if (installedModule.guestBundleUrl === undefined) return readModuleGuestBundle(installedModule.name);
  if (!installedModule.guestBundleSha256Hex) {
    // validateExportProjectInput/toExportProjectInput both guarantee this
    // pairing — reaching here means a caller of hydrateProjectData bypassed
    // both, which is a real bug in this module, not a user input problem.
    throw new Error(`forge export: installed module "${installedModule.name}" has a guestBundleUrl but no guestBundleSha256Hex to verify it against.`);
  }
  return fetchGuestBundle(installedModule.guestBundleUrl, installedModule.guestBundleSha256Hex);
}

/** `data:` URI MIME type for a pack asset's own file extension — every fixture pack today ships `.png`; this covers the other web-safe raster formats an author might reasonably ship rather than assuming PNG unconditionally. */
function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

/**
 * K1 Phase 2b: resolves `packName` (`ProjectDocument.activePack`) to its
 * real manifest and the actual bytes of every asset this export can use —
 * mirrors `packages/editor/src/canvas/packTiles.ts`'s own tier-3
 * ("active pack") resolution scope exactly (ground tileset + character
 * sheets), but reads from `fixtures/packs/*` on disk instead of fetching
 * a dev-server URL, and returns the asset bytes themselves (base64
 * `data:` URIs) rather than a URL to fetch later — an exported build has
 * no server to fetch from (docs/security/THREAT-MODEL.md's play-origin
 * isolation), so every byte it needs has to already be embedded.
 *
 * Never throws: a pack that can't be found, fails manifest validation, or
 * whose declared image file is missing on disk is a reason to skip that
 * one asset (or the whole pack) and fall back to the renderer's own
 * placeholder colors/markers, exactly like a broken pack does in the
 * editor's own `loadActivePackContext` — an author's export must never
 * fail outright over pack art specifically. Every skip is a printed
 * warning, per CLAUDE.md 1.2.11, not a silent gap.
 */
function resolvePackData(packName: string): PlayerPackData | undefined {
  if (!existsSync(FIXTURE_PACKS_DIR)) return undefined;
  let packDir: string | undefined;
  for (const entry of readdirSync(FIXTURE_PACKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(FIXTURE_PACKS_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const candidate = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
    if (candidate.name === packName) {
      packDir = join(FIXTURE_PACKS_DIR, entry.name);
      break;
    }
  }
  if (!packDir) {
    console.warn(`[forge export] active pack "${packName}" was not found under fixtures/packs — exporting with placeholder art instead.`);
    return undefined;
  }

  const result = validateArtPackManifest(JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8")));
  if (!result.ok) {
    console.warn(`[forge export] active pack "${packName}"'s manifest failed validation (${JSON.stringify(result.errors)}) — exporting with placeholder art instead.`);
    return undefined;
  }
  const manifest = result.manifest!;

  const declaredPaths = new Set<string>();
  for (const tileset of Object.values(manifest.tilesets)) declaredPaths.add(tileset.src);
  if (manifest.characters) for (const path of Object.values(manifest.characters.sheets)) declaredPaths.add(path);
  // K1 Phase 2: wagons (mounts) and weapons — same "collect every declared
  // src, base64-embed whatever actually exists on disk" treatment as
  // tilesets/characters above.
  if (manifest.wagons) for (const wagon of Object.values(manifest.wagons)) declaredPaths.add(wagon.src);
  if (manifest.weapons) for (const weapon of Object.values(manifest.weapons)) declaredPaths.add(weapon.src);

  const assets: Record<string, string> = {};
  for (const path of declaredPaths) {
    const filePath = join(packDir, path);
    if (!existsSync(filePath)) {
      console.warn(`[forge export] active pack "${packName}" declares "${path}" but that file doesn't exist under ${packDir} — that asset falls back to a placeholder.`);
      continue;
    }
    assets[path] = `data:${mimeTypeFor(path)};base64,${readFileSync(filePath).toString("base64")}`;
  }

  return { name: packName, manifest, assets };
}

async function hydrateProjectData(input: ExportProjectInput): Promise<PlayerProjectData> {
  const { activePack, ...rest } = input;
  const pack = activePack ? resolvePackData(activePack) : undefined;
  return {
    ...rest,
    installedModules: await Promise.all(
      input.installedModules.map(async (installedModule) => ({
        ...installedModule,
        guestBundleSource: await resolveGuestBundleSource(installedModule),
      })),
    ),
    // exactOptionalPropertyTypes: omit rather than assign `undefined` —
    // `resolvePackData` itself can come back empty (pack not found,
    // failed validation) even when `activePack` was set, same convention
    // this whole file already follows for `guestBundleUrl`/etc.
    ...(pack ? { pack } : {}),
  };
}

function readWasmBinaryBase64(): string {
  const require = createRequire(join(PLAYER_DIR, "package.json"));
  const quickjsEmscriptenPkgJson = require.resolve("quickjs-emscripten/package.json");
  const wasmfilePkgJson = require.resolve("@jitl/quickjs-wasmfile-release-sync/package.json", {
    paths: [dirname(quickjsEmscriptenPkgJson)],
  });
  const wasmPath = join(dirname(wasmfilePkgJson), "dist", "emscripten-module.wasm");
  return readFileSync(wasmPath).toString("base64");
}

function writeGeneratedFiles(projectData: PlayerProjectData): void {
  const generatedDir = join(PLAYER_DIR, "src", "generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(
    join(generatedDir, "projectData.ts"),
    `// AUTO-GENERATED by forge export — do not edit by hand.\n` +
      `import type { PlayerProjectData } from "../playerProjectData.js";\n\n` +
      `export const PROJECT_DATA: PlayerProjectData = ${JSON.stringify(projectData, null, 2)};\n`,
  );
  writeFileSync(
    join(generatedDir, "wasmBinaryBase64.ts"),
    `// AUTO-GENERATED by forge export — do not edit by hand.\n` +
      `export const WASM_BINARY_BASE64: string = ${JSON.stringify(readWasmBinaryBase64())};\n`,
  );
}

interface LicensedPackage {
  readonly name: string;
  readonly versions: readonly string[];
}

/**
 * docs/SPEC.md Section 15.3: the export "must generate LICENSES.txt, and
 * the build must fail if any dependency's license is unsatisfiable for
 * redistribution." Reuses the exact same allowlist
 * `tools/security/license-check.mjs` already enforces for the whole
 * repo (`tools/security/licenses.json`) — that file's own description
 * already names "redistributing exported games" as the actual
 * constraint, not a separate policy invented here. Scoped to
 * `@forge/player`'s own production dependency closure (`--prod
 * --filter`), not the whole monorepo — devDependencies like vite/esbuild
 * never ship in the export and have no bearing on what a player receives.
 */
function writeLicensesFile(outDir: string): void {
  const allowlist = (JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { allowed: readonly string[] }).allowed;

  const raw = execFileSync("pnpm", ["licenses", "list", "--json", "--prod", "--filter", "@forge/player"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = JSON.parse(raw) as Record<string, readonly LicensedPackage[]>;

  const disallowed = Object.keys(byLicense).filter((license) => !allowlist.includes(license));
  if (disallowed.length > 0) {
    throw new Error(
      `forge export: refusing to export — disallowed license(s) in @forge/player's bundled dependency tree: ${disallowed.join(", ")}. ` +
        `Add the license to tools/security/licenses.json only after confirming it's compatible with redistributing exported games.`,
    );
  }

  const lines = ["Third-party licenses for this exported game", "=".repeat(44), ""];
  for (const license of Object.keys(byLicense).sort()) {
    lines.push(license, "-".repeat(license.length));
    for (const pkg of [...byLicense[license]!].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${pkg.name}@${pkg.versions.join(",")}`);
    }
    lines.push("");
  }
  writeFileSync(join(outDir, "LICENSES.txt"), lines.join("\n"));
}

function validateProjectDocumentExportFile(value: unknown, sourcePath: string): asserts value is ProjectDocumentExportFile {
  const fail = (reason: string): never => {
    throw new Error(`forge export: "${sourcePath}" is not a valid project-document file — ${reason}`);
  };
  if (typeof value !== "object" || value === null) fail("expected a JSON object");
  const data = value as Record<string, unknown>;
  if (typeof data.projectId !== "string" || data.projectId === "") fail('"projectId" must be a non-empty string');
  if (typeof data.document !== "object" || data.document === null) fail('"document" must be an object');
}

function resolveExportProjectInput(options: ExportOptions): ExportProjectInput {
  if (options.projectPath && options.documentPath) {
    throw new Error("forge export: pass exactly one of --project or --document, not both.");
  }
  if (options.documentPath) {
    const raw: unknown = JSON.parse(readFileSync(options.documentPath, "utf8"));
    validateProjectDocumentExportFile(raw, options.documentPath);
    return toExportProjectInput(raw.document, {
      projectId: raw.projectId,
      resolveModuleVersion: resolvePackageVersion,
      resolveEngineVersion: () => resolvePackageVersion("@forge/core"),
    });
  }
  if (options.projectPath) {
    const raw: unknown = JSON.parse(readFileSync(options.projectPath, "utf8"));
    validateExportProjectInput(raw, options.projectPath);
    return { ...raw, dataTables: raw.dataTables ?? {} };
  }
  throw new Error("forge export: pass one of --project or --document.");
}

export async function runExport(options: ExportOptions): Promise<void> {
  const exportProjectInput = resolveExportProjectInput(options);
  const projectData = await hydrateProjectData(exportProjectInput);

  writeGeneratedFiles(projectData);

  // scripts/build-app.mjs: vite build, then inlineBundle — see that
  // script's and packages/player/scripts/inline-bundle.mjs's own doc
  // comments for exactly why a plain `vite build` output alone does not
  // load under file:// (CORS on every ES module load, confirmed with a
  // real Playwright file:// run, not assumed).
  execFileSync("node", ["scripts/build-app.mjs"], { cwd: PLAYER_DIR, stdio: "inherit" });

  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  cpSync(join(PLAYER_DIR, "dist-app"), options.outDir, { recursive: true });

  writeLicensesFile(options.outDir);

  console.log(`forge export: wrote a standalone, file://-loadable build to ${options.outDir}`);
}

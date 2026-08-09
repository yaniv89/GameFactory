import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Same technique tools/security/check-module-boundaries.mjs and packages/art-pack/test/fixturePack.test.ts already use — walk up from this file until pnpm-workspace.yaml is found. */
export function findRepoRoot(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  for (let depth = 0; depth < 20; depth++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`findRepoRoot: could not find pnpm-workspace.yaml walking up from "${startDir}"`);
}

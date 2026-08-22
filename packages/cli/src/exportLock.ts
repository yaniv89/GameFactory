// #183: `runExport` (commands/export.ts) always drives its build through
// two fixed, shared locations in `packages/player`'s own checked-in
// source tree — `src/generated/*.ts` (the project data/WASM this
// invocation is exporting, read by `main.ts` as a plain relative
// import) and `dist-app/` (vite's own fixed `build.outDir`, then
// `inline-bundle.mjs`'s in-place rewrite of it). Neither is
// parameterizable without either rewriting `main.ts`'s own import to an
// indirection layer (touches shipped runtime code for a CLI-only
// concern) or duplicating the whole package's source tree per
// invocation (expensive, and `node_modules` resolution would need to
// follow). Two concurrent `forge export` calls against one checkout
// race on both: one process's `writeGeneratedFiles` can overwrite the
// generated source out from under another process's already-started
// `vite build` (silently bundling the wrong project's data — worse
// than a loud failure), and `inline-bundle.mjs`'s own asset-count
// assertion can trip on a half-written `dist-app/` from a second,
// interleaved `vite build`.
//
// The correct fix for a single shared build tree is to make the whole
// "write generated files -> vite build -> inline -> copy out" sequence
// mutually exclusive across processes — an OS-level advisory lock, not
// a retry/detect-and-fail. `fs.writeFileSync(path, ..., { flag: "wx" })`
// is atomic (fails with `EEXIST` if the file already exists) on every
// platform Node supports, so it's a real mutex with no new dependency
// (`proper-lockfile` and friends are outside CLAUDE.md Section 2's
// pinned list; this needs nothing they provide beyond what `node:fs`
// already gives for free).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** How long a real build has ever taken in this repo's own CI/dev runs (~4-6s, `dist-app/`'s own build logs) — 5 minutes is a wide margin, not a tuned guess, before a lock is considered abandoned by a crashed holder rather than held by a slow-but-live one. */
const STALE_LOCK_MS = 5 * 60 * 1000;
/** How long a caller waits for someone else's real, live build before giving up loudly — long enough for several real builds to queue, short enough that a genuinely stuck process doesn't hang a caller (CI) forever. */
const ACQUIRE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 100;

interface LockPayload {
  readonly pid: number;
  readonly acquiredAtMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if `pid` names a process this OS still schedules — the standard `kill(pid, 0)` liveness probe (sends no signal, only checks permission/existence), the same technique every Unix process-lock implementation uses instead of guessing from a timestamp alone. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH (no such process) or EPERM (exists, but not ours) — either way this lock's own writer is gone or unreachable; treat as not alive for reclaim purposes since EPERM against a same-user CI/dev box in practice means ESRCH for a pid that's been recycled.
  }
}

function readLockPayload(lockPath: string): LockPayload | undefined {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as LockPayload;
  } catch {
    return undefined; // corrupt/partially-written/already-removed — safe to treat as reclaimable, same as a stale lock.
  }
}

function isReclaimable(lockPath: string): boolean {
  const payload = readLockPayload(lockPath);
  if (!payload) return true;
  if (Date.now() - payload.acquiredAtMs > STALE_LOCK_MS) return true;
  return !isProcessAlive(payload.pid);
}

/**
 * Acquires an exclusive, cross-process lock at `lockPath`, runs `fn`,
 * and always releases it — the entire shared-build-tree critical
 * section (`runExport`'s own doc comment on why) serialized across
 * however many `forge export` processes are running against this one
 * checkout, instead of racing.
 */
export async function withExportLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAtMs: Date.now() } satisfies LockPayload), { flag: "wx" });
      break;
    } catch (err) {
      if (!(err instanceof Error) || !("code" in err) || (err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (existsSync(lockPath) && isReclaimable(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // Lost a race to reclaim it against another waiter — loop and retry; whoever actually removed it (or a live holder that just finished) will let a subsequent writeFileSync succeed.
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `forge export: timed out after ${ACQUIRE_TIMEOUT_MS}ms waiting for another "forge export" build in this checkout to finish (lock held at ${lockPath}). If nothing is actually running, delete that file and retry.`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Already gone (e.g. reclaimed by a waiter that decided we were stale mid-run) — nothing more to release.
    }
  }
}

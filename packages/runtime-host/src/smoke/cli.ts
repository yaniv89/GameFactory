import { runModuleSmokeTest, type SmokeRunOptions } from "./smokeRunner";

/**
 * The subprocess entry point `services/Forge.Functions.Scan` spawns for
 * docs/SPEC.md Section 10.4 gate 4 — the cross-language boundary CLAUDE.md
 * Section 0's "push back" clause was invoked over: the sandbox itself
 * (`ModuleBridge`/`ModuleRuntime`) is TypeScript, the publish pipeline is
 * .NET, and rewriting the sandbox in C# would mean re-proving every claim
 * `sandbox-escape.test.ts` already proves, against a second implementation
 * nobody asked for. A subprocess with a JSON-in/JSON-out contract on
 * stdin/stdout is the actual isolation boundary the caller gets for free:
 * the .NET host process never evaluates any bundle content itself — it
 * only reads back a verdict this process computed by running the bundle
 * inside the real sandbox, same as the player-facing runtime does.
 *
 * Contract:
 * - stdin: one JSON document, `SmokeRunOptions` (`bundleSource` required).
 * - stdout, on success: one JSON line, the `SmokeRunReport` — regardless
 *   of whether the verdict is "passed" or "blocked". A "blocked" verdict
 *   is this gate doing its job, not a harness failure, so it still exits
 *   0.
 * - stdout, on a harness-level failure (malformed stdin, `runModuleSmokeTest`
 *   itself throwing before it could even produce a verdict — e.g. an
 *   options field so malformed `ModuleBridge.create()` rejects it): one
 *   JSON line `{ "harnessError": string }`, exit code 1. The caller must
 *   treat this differently from a "blocked" verdict — a harness failure
 *   says nothing about whether the bundle itself is safe, and must never
 *   be recorded as a scan result against the author's package.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const input = await readStdin();

  let options: SmokeRunOptions;
  try {
    options = JSON.parse(input) as SmokeRunOptions;
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ harnessError: `invalid JSON on stdin: ${err instanceof Error ? err.message : String(err)}` })}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runModuleSmokeTest(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ harnessError: err instanceof Error ? err.message : String(err) })}\n`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  // A failure inside main() itself (readStdin() rejecting) never got a
  // chance to write a harnessError line above — CLAUDE.md guardrail 11:
  // never let a failure vanish silently.
  process.stderr.write(`smoke-run CLI: unrecoverable failure: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});

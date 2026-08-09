#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runExport } from "./commands/export.js";

/**
 * forge CLI (Milestone M6, docs/SPEC.md Section 20). `export` is the
 * first real subcommand — the rest of the CLI's scope (local dev loop,
 * CI helpers, bulk operations) stays not implemented until a later
 * phase actually needs it.
 */
function printUsage(): void {
  console.error("Usage: forge export --project <path/to/playerProjectData.json> --out <dir>");
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "export") {
    const { values } = parseArgs({
      args: rest,
      options: {
        project: { type: "string" },
        out: { type: "string" },
      },
    });
    if (!values.project || !values.out) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    runExport({ projectPath: values.project, outDir: values.out });
    return;
  }

  console.error(`forge: unknown command "${command ?? ""}"`);
  printUsage();
  process.exitCode = 1;
}

main();

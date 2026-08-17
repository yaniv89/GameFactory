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
  console.error(
    "Usage: forge export (--project <path/to/exportProjectInput.json> | --document <path/to/projectDocument.json>) --out <dir>",
  );
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "export") {
    const { values } = parseArgs({
      args: rest,
      options: {
        project: { type: "string" },
        document: { type: "string" },
        out: { type: "string" },
      },
    });
    if (!values.out || (!values.project && !values.document) || (values.project && values.document)) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    runExport({
      ...(values.project ? { projectPath: values.project } : {}),
      ...(values.document ? { documentPath: values.document } : {}),
      outDir: values.out,
    });
    return;
  }

  console.error(`forge: unknown command "${command ?? ""}"`);
  printUsage();
  process.exitCode = 1;
}

main();

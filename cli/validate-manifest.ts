#!/usr/bin/env node
/**
 * CLI: Manifest Validator & Diagnostics (Manifest v2)
 * Usage: npx tsx cli/validate-manifest.ts <path-to-manifest.json>
 */

import fs from "fs";
import path from "path";
import { diagnoseManifest } from "../src/manifest/diagnostics.js";

async function main() {
  const args = process.argv.slice(2);
  const targetPath = args[0] || "./merchant-config.json";

  const resolved = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(resolved)) {
    console.error(`\x1b[31mError: Manifest file not found at ${resolved}\x1b[0m`);
    process.exit(1);
  }

  let content: unknown;
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    content = JSON.parse(raw);
  } catch (err: any) {
    console.error(`\x1b[31mError parsing JSON in ${targetPath}: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  MERCHANT MCP MANIFEST V2 VALIDATOR`);
  console.log(`══════════════════════════════════════════════════════════════════════`);
  console.log(`  Target Manifest  : ${resolved}`);

  const report = diagnoseManifest(content);

  console.log(`  Manifest Version : ${report.manifest_version}`);
  console.log(`  Integration Level: \x1b[36m${report.integration_level.toUpperCase()}\x1b[0m`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);

  if (report.issues.length > 0) {
    console.log(`\x1b[1mDiagnostic Issues (${report.issues.length}):\x1b[0m`);
    for (const issue of report.issues) {
      const color =
        issue.severity === "error"
          ? "\x1b[31m[ERROR]"
          : issue.severity === "warning"
          ? "\x1b[33m[WARN]"
          : "\x1b[34m[INFO]";
      console.log(`  ${color} ${issue.code} at ${issue.field}\x1b[0m`);
      console.log(`    Message   : ${issue.message}`);
      if (issue.suggestion) {
        console.log(`    Suggestion: \x1b[90m${issue.suggestion}\x1b[0m`);
      }
      console.log();
    }
  } else {
    console.log(`\x1b[32m✔ Schema validation passed with 0 errors.\x1b[0m\n`);
  }

  if (report.unexposed_capabilities.length > 0) {
    console.log(`\x1b[1mCapability Recommendations (${report.unexposed_capabilities.length} unexposed):\x1b[0m`);
    for (const cap of report.unexposed_capabilities) {
      console.log(`  • \x1b[35m${cap.capability}\x1b[0m`);
      console.log(`    Missing fields: ${cap.missing_fields.join(", ")}`);
      console.log(`    Action        : \x1b[90m${cap.suggestion}\x1b[0m\n`);
    }
  }

  if (!report.validation_passed) {
    console.error(`\x1b[31m✖ Manifest validation failed. Fix the errors above before deploying.\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m✔ Manifest is valid and ready for deployment.\x1b[0m\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error running manifest validator:", err);
  process.exit(1);
});

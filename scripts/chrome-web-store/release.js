// Local, network-free release rehearsal: `npm run release:chrome -- --dry-run`.
//
// This command NEVER authenticates with, uploads to, or publishes to the
// Chrome Web Store — that is deliberately CI-only (see run-upload.js /
// run-publish.js, invoked only from .github/workflows/release-chrome-web-store.yml
// against the protected "production" environment). This script only runs the
// same checks the CI "validate" and "build" jobs run, so a release can be
// rehearsed locally before pushing to `prod`.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildExtensionPackage } from "./package-extension.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

async function main() {
  console.log("Running Chrome Web Store release rehearsal (dry run — no network calls will be made)\n");

  run("node", [join("scripts", "validate-chrome-store-docs.js")]);
  console.log("✓ Chrome Web Store documentation validation passed\n");

  run("node", [join("scripts", "chrome-web-store", "validate-manifest-version.js")]);
  console.log();

  const info = buildExtensionPackage({});
  console.log(`✓ Extension package created: ${info.zipPath}`);
  console.log(`  Version: ${info.version}`);
  console.log(`  Contents: ${info.entries.join(", ")}\n`);

  console.log("Dry run complete. No authentication, upload, or publish call was made.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Release rehearsal failed: ${err.message}`);
    process.exit(1);
  });
}

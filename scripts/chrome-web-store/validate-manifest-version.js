// Fails the release if manifest.json's version was not bumped relative to the
// previously released commit on this branch. The Chrome Web Store API v2 has no
// "get current published version" endpoint (that only existed on the deprecated
// v1.1 API), so the previous commit's manifest.json is used as the safe,
// self-contained stand-in for "the version currently live on the Store".
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseManifest, assertVersionBumped } from "./manifest-utils.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readPreviousManifest(previousRef) {
  try {
    return execFileSync("git", ["show", `${previousRef}:manifest.json`], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

export function validateVersionBump({ currentManifestJson, previousManifestJson }) {
  const current = parseManifest(currentManifestJson);

  if (previousManifestJson === null) {
    console.warn(
      "⚠ Could not read manifest.json from the previous commit (no parent commit found) — skipping version-bump check."
    );
    return { checked: false, version: current.version };
  }

  const previous = parseManifest(previousManifestJson);
  assertVersionBumped(previous.version, current.version);

  return { checked: true, previousVersion: previous.version, version: current.version };
}

async function main() {
  const previousRef = process.env.CWS_PREVIOUS_REF || process.argv[2] || "HEAD^";
  const currentManifestJson = readFileSync(join(ROOT, "manifest.json"), "utf8");
  const previousManifestJson = readPreviousManifest(previousRef);

  const result = validateVersionBump({ currentManifestJson, previousManifestJson });

  if (result.checked) {
    console.log(`✓ manifest.json version ${result.version} > previous ${result.previousVersion} (${previousRef})`);
  } else {
    console.log(`✓ manifest.json version ${result.version} (unverified: no previous commit to compare against)`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Manifest version validation failed: ${err.message}`);
    process.exit(1);
  });
}

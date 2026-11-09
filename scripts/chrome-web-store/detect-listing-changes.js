// Detects whether the canonical Chrome Web Store listing docs
// (docs/chrome-web-store/) changed since the previously released commit on
// `prod`. Those fields (description, single-purpose, privacy justifications)
// have no v2 API for programmatic sync (see docs/release.md), so a change
// here is a signal that a human needs to copy the new text into the Chrome
// Web Store Developer Dashboard — this only detects that, it never touches
// the Dashboard itself.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LISTING_DIR = "docs/chrome-web-store";

export function listingChanged(changedFiles) {
  return changedFiles.some((file) => file === LISTING_DIR || file.startsWith(`${LISTING_DIR}/`));
}

function getChangedFiles(previousRef) {
  const output = execFileSync("git", ["diff", "--name-only", previousRef, "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const previousRef = process.env.CWS_PREVIOUS_REF || process.argv[2] || "HEAD^";

  let changed;
  try {
    changed = listingChanged(getChangedFiles(previousRef));
  } catch {
    // Can't determine (e.g. no parent commit) — default to requiring the
    // extra approval rather than silently skipping it.
    console.warn(
      `⚠ Could not diff against ${previousRef} — assuming the Chrome Web Store listing may need a manual sync, to be safe.`
    );
    changed = true;
  }

  if (changed) {
    console.log("⚠ docs/chrome-web-store/ changed since the last release.");
    console.log(
      "  The Chrome Web Store API cannot update the listing description, single-purpose text, or privacy justifications — copy the new text into the Developer Dashboard before (or as part of) approving publish."
    );
  } else {
    console.log("✓ docs/chrome-web-store/ is unchanged since the last release — no manual listing sync needed.");
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `listing_changed=${changed}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Listing-change detection failed: ${err.message}`);
    process.exit(1);
  });
}

// Builds the production Chrome extension package: copies the runtime files
// that actually ship (nothing else) into a clean staging directory, validates
// the result, and zips it. There is no bundler/transpiler in this project
// (see CLAUDE.md) — "build" here means "select the right files".
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseManifest, assertManifestDescriptionWithinLimit, storeManifest } from "./manifest-utils.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Not dot-prefixed: actions/upload-artifact@v4 excludes hidden
// (dot-prefixed) paths from uploads by default, which would silently drop
// this whole directory in CI.
const RELEASE_DIR = join(ROOT, "release");
const STAGING_DIR = join(RELEASE_DIR, "extension");

// Everything the packaged extension is allowed to contain. Anything not
// listed here (tests/, docs/, scripts/, .github/, node_modules/, CLAUDE.md,
// README.md, etc.) is deliberately left out of the Store package.
export const PACKAGE_ENTRIES = ["manifest.json", "sidepanel.html", "assets", "src"];

// Normalizes mtimes before zipping so the archive doesn't embed the build
// machine's clock (best-effort reproducibility, not a byte-identical-output
// guarantee across platforms/zip implementations). Must be on/after
// 1980-01-01: the ZIP/DOS date format cannot represent anything earlier, and
// both `zip` and PowerShell's Compress-Archive reject it.
const DETERMINISTIC_MTIME = new Date("2000-01-01T00:00:00Z");

export function validatePackageContents(entries) {
  const errors = [];
  if (!entries.includes("manifest.json")) {
    errors.push("Package is missing manifest.json at its root");
  }
  const forbidden = ["node_modules", "tests", "docs", "scripts", ".github", ".git", "CLAUDE.md", "package.json", "local.settings.json"];
  for (const name of forbidden) {
    if (entries.includes(name)) {
      errors.push(`Package must not contain "${name}"`);
    }
  }
  return errors;
}

function setDeterministicMtimes(path) {
  utimesSync(path, DETERMINISTIC_MTIME, DETERMINISTIC_MTIME);
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) {
      setDeterministicMtimes(join(path, entry));
    }
  }
}

function createZip(stagingDir, zipPath) {
  rmSync(zipPath, { force: true });

  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      // $ErrorActionPreference = 'Stop' is required: Compress-Archive raises
      // most failures as non-terminating errors, which otherwise leave
      // powershell.exe exiting 0 with no zip actually written.
      `$ErrorActionPreference = 'Stop'; Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ]);
  } else {
    execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: stagingDir });
  }

  if (!existsSync(zipPath)) {
    throw new Error(`Zip creation reported success but ${zipPath} does not exist`);
  }
}

export function buildExtensionPackage({ root = ROOT } = {}) {
  const manifestJson = readFileSync(join(root, "manifest.json"), "utf8");
  const manifest = parseManifest(manifestJson);
  assertManifestDescriptionWithinLimit(manifest.description);

  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(STAGING_DIR, { recursive: true });

  for (const entry of PACKAGE_ENTRIES) {
    const source = join(root, entry);
    if (!existsSync(source)) continue;
    cpSync(source, join(STAGING_DIR, entry), { recursive: true });
  }

  // The Store gives the item its own id and rejects a manifest "key".
  writeFileSync(join(STAGING_DIR, "manifest.json"), `${JSON.stringify(storeManifest(manifest), null, 2)}\n`);

  const packagedEntries = readdirSync(STAGING_DIR);
  const errors = validatePackageContents(packagedEntries);
  if (errors.length > 0) {
    throw new Error(`Package validation failed:\n  - ${errors.join("\n  - ")}`);
  }

  setDeterministicMtimes(STAGING_DIR);

  const zipPath = join(RELEASE_DIR, `leads-automate-v${manifest.version}.zip`);
  createZip(STAGING_DIR, zipPath);

  const info = { version: manifest.version, zipPath, entries: packagedEntries };
  writeFileSync(join(RELEASE_DIR, "package-info.json"), JSON.stringify(info, null, 2));

  return info;
}

async function main() {
  const info = buildExtensionPackage({});
  console.log(`✓ Extension package created: ${info.zipPath} (version ${info.version})`);
  console.log(`  Contents: ${info.entries.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Packaging failed: ${err.message}`);
    process.exit(1);
  });
}

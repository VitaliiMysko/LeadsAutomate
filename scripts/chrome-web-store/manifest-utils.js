// Shared manifest.json parsing/validation used by packaging and version-gate checks.

export function parseManifest(rawJson) {
  let manifest;
  try {
    manifest = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`manifest.json is not valid JSON: ${err.message}`);
  }

  if (manifest.manifest_version !== 3) {
    throw new Error(`manifest.json manifest_version must be 3, got ${manifest.manifest_version}`);
  }

  parseVersion(manifest.version);

  return manifest;
}

// Chrome versions are 1-4 dot-separated integers, each 0-65535.
export function parseVersion(version) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Invalid manifest version: ${JSON.stringify(version)}`);
  }

  const parts = version.split(".");
  if (parts.length === 0 || parts.length > 4) {
    throw new Error(`Invalid manifest version: ${version}`);
  }

  const numbers = parts.map((part) => {
    if (!/^\d+$/.test(part) || Number(part) > 65535) {
      throw new Error(`Invalid manifest version: ${version}`);
    }
    return Number(part);
  });

  return numbers;
}

export function compareVersions(a, b) {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

export function assertVersionBumped(previousVersion, nextVersion) {
  if (compareVersions(nextVersion, previousVersion) <= 0) {
    throw new Error(
      `manifest.json version (${nextVersion}) must be greater than the previously released version (${previousVersion})`
    );
  }
}

// The Chrome Web Store rejects the whole package (PKG_MANIFEST_SUMMARY_TOO_LONG)
// if manifest.json's own "description" field — a short summary, distinct
// from docs/chrome-web-store/description.md's full listing text — exceeds
// this. Checked only at packaging time for the manifest actually being
// released, not inside parseManifest: that function also parses historical
// commits purely to compare version numbers, and enforcing this there would
// break comparisons against any past commit that already violated it.
export const MAX_MANIFEST_DESCRIPTION_LENGTH = 132;

export function assertManifestDescriptionWithinLimit(description) {
  if (typeof description === "string" && description.length > MAX_MANIFEST_DESCRIPTION_LENGTH) {
    throw new Error(
      `manifest.json "description" is ${description.length} characters, exceeds the Chrome Web Store's ${MAX_MANIFEST_DESCRIPTION_LENGTH}-character limit for that field (this is the manifest's own short description, not docs/chrome-web-store/description.md)`
    );
  }
}

// The manifest as packaged for the Chrome Web Store: without "key", which
// only fixes the id of an unpacked copy. The Store rejects a package that
// has one and gives the item its own id.
export function storeManifest(manifest) {
  const { key, ...rest } = manifest;
  return rest;
}

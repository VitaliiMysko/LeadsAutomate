import {
  parseManifest,
  parseVersion,
  compareVersions,
  assertVersionBumped,
  assertManifestDescriptionWithinLimit,
  MAX_MANIFEST_DESCRIPTION_LENGTH,
  storeManifest,
} from "../scripts/chrome-web-store/manifest-utils.js";

describe("parseVersion", () => {
  test("accepts 1-4 numeric parts", () => {
    expect(parseVersion("3.3.10")).toEqual([3, 3, 10]);
    expect(parseVersion("1")).toEqual([1]);
    expect(parseVersion("1.2.3.4")).toEqual([1, 2, 3, 4]);
  });

  test("rejects non-numeric, empty, too many parts, or out-of-range parts", () => {
    expect(() => parseVersion("")).toThrow();
    expect(() => parseVersion("1.2.3.4.5")).toThrow();
    expect(() => parseVersion("1.a.3")).toThrow();
    expect(() => parseVersion("1.99999")).toThrow();
    expect(() => parseVersion(undefined)).toThrow();
  });
});

describe("compareVersions", () => {
  test("compares numerically, not lexically", () => {
    expect(compareVersions("3.3.10", "3.3.9")).toBeGreaterThan(0);
    expect(compareVersions("3.3.9", "3.3.10")).toBeLessThan(0);
    expect(compareVersions("3.3.10", "3.3.10")).toBe(0);
  });

  test("treats missing trailing parts as zero", () => {
    expect(compareVersions("3.3", "3.3.0")).toBe(0);
    expect(compareVersions("3.3.1", "3.3")).toBeGreaterThan(0);
  });
});

describe("assertVersionBumped", () => {
  test("passes when the new version is strictly greater", () => {
    expect(() => assertVersionBumped("3.3.9", "3.3.10")).not.toThrow();
  });

  test("throws when equal or lower", () => {
    expect(() => assertVersionBumped("3.3.10", "3.3.10")).toThrow();
    expect(() => assertVersionBumped("3.3.10", "3.3.9")).toThrow();
  });
});

describe("parseManifest", () => {
  test("parses a valid manifest", () => {
    const manifest = parseManifest(JSON.stringify({ manifest_version: 3, version: "1.0.0" }));
    expect(manifest.version).toBe("1.0.0");
  });

  test("rejects invalid JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(/not valid JSON/);
  });

  test("rejects wrong manifest_version", () => {
    expect(() => parseManifest(JSON.stringify({ manifest_version: 2, version: "1.0.0" }))).toThrow(/manifest_version/);
  });

  test("rejects invalid version field", () => {
    expect(() => parseManifest(JSON.stringify({ manifest_version: 3, version: "not-a-version" }))).toThrow();
  });

  test("does not itself enforce the description length limit (historical commits may already violate it)", () => {
    const oversized = "x".repeat(MAX_MANIFEST_DESCRIPTION_LENGTH + 1);
    expect(() =>
      parseManifest(JSON.stringify({ manifest_version: 3, version: "1.0.0", description: oversized }))
    ).not.toThrow();
  });
});

describe("assertManifestDescriptionWithinLimit", () => {
  test("passes at or under the Chrome Web Store's limit", () => {
    expect(() => assertManifestDescriptionWithinLimit("x".repeat(MAX_MANIFEST_DESCRIPTION_LENGTH))).not.toThrow();
  });

  test("throws over the limit", () => {
    expect(() => assertManifestDescriptionWithinLimit("x".repeat(MAX_MANIFEST_DESCRIPTION_LENGTH + 1))).toThrow(
      /132-character limit/
    );
  });

  test("ignores a missing/non-string description", () => {
    expect(() => assertManifestDescriptionWithinLimit(undefined)).not.toThrow();
  });
});

describe("storeManifest", () => {
  test("drops the key and keeps everything else", () => {
    const manifest = { manifest_version: 3, version: "1.0.0", key: "abc", permissions: ["storage"] };
    expect(storeManifest(manifest)).toEqual({ manifest_version: 3, version: "1.0.0", permissions: ["storage"] });
    expect(manifest.key).toBe("abc");
  });
});

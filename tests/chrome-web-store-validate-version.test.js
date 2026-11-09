import { validateVersionBump } from "../scripts/chrome-web-store/validate-manifest-version.js";

function manifestJson(version) {
  return JSON.stringify({ manifest_version: 3, version });
}

describe("validateVersionBump", () => {
  test("succeeds when the version increased", () => {
    const result = validateVersionBump({
      currentManifestJson: manifestJson("3.3.10"),
      previousManifestJson: manifestJson("3.3.9"),
    });
    expect(result).toEqual({ checked: true, previousVersion: "3.3.9", version: "3.3.10" });
  });

  test("fails when the version did not change", () => {
    expect(() =>
      validateVersionBump({
        currentManifestJson: manifestJson("3.3.9"),
        previousManifestJson: manifestJson("3.3.9"),
      })
    ).toThrow(/must be greater/);
  });

  test("fails when the version decreased", () => {
    expect(() =>
      validateVersionBump({
        currentManifestJson: manifestJson("3.3.8"),
        previousManifestJson: manifestJson("3.3.9"),
      })
    ).toThrow(/must be greater/);
  });

  test("skips the check (without failing) when there is no previous commit to compare", () => {
    const result = validateVersionBump({
      currentManifestJson: manifestJson("3.3.10"),
      previousManifestJson: null,
    });
    expect(result).toEqual({ checked: false, version: "3.3.10" });
  });

  test("fails on a malformed current manifest regardless of the previous one", () => {
    expect(() =>
      validateVersionBump({
        currentManifestJson: "{not json",
        previousManifestJson: manifestJson("3.3.9"),
      })
    ).toThrow(/not valid JSON/);
  });
});

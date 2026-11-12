import { validatePackageContents, PACKAGE_ENTRIES } from "../scripts/chrome-web-store/package-extension.js";

describe("PACKAGE_ENTRIES", () => {
  test("only lists the extension's actual runtime files", () => {
    expect(PACKAGE_ENTRIES).toEqual(["manifest.json", "sidepanel.html", "assets", "src"]);
  });
});

describe("validatePackageContents", () => {
  test("passes for a well-formed package", () => {
    expect(validatePackageContents(["manifest.json", "sidepanel.html", "assets", "src"])).toEqual([]);
  });

  test("fails when manifest.json is missing", () => {
    const errors = validatePackageContents(["sidepanel.html", "src"]);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("manifest.json")]));
  });

  test("fails when a development-only directory leaked into the package", () => {
    const errors = validatePackageContents(["manifest.json", "tests", "node_modules"]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining("tests"), expect.stringContaining("node_modules")])
    );
  });

  test("fails when the developer's local settings leaked into the package", () => {
    const errors = validatePackageContents(["manifest.json", "local.settings.json"]);
    expect(errors).toEqual([expect.stringContaining("local.settings.json")]);
  });
});

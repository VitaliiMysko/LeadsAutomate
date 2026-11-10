import { versionLabel } from "../src/utils/version-label.js";

describe("versionLabel", () => {
  test("marks a development copy", () => {
    expect(versionLabel("0.8.0", "development")).toBe("v0.8.0 (dev)");
  });

  test("shows just the version for an installed copy", () => {
    expect(versionLabel("0.8.0", "normal")).toBe("v0.8.0");
  });

  test("shows just the version when the install type is unknown", () => {
    expect(versionLabel("0.8.0", null)).toBe("v0.8.0");
  });
});

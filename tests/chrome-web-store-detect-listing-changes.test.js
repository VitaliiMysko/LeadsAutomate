import { listingChanged } from "../scripts/chrome-web-store/detect-listing-changes.js";

describe("listingChanged", () => {
  test("true when a file under docs/chrome-web-store/ changed", () => {
    expect(listingChanged(["docs/chrome-web-store/description.md", "src/utils/text-utils.js"])).toBe(true);
    expect(listingChanged(["docs/chrome-web-store/privacy/storage.md"])).toBe(true);
  });

  test("false when nothing under docs/chrome-web-store/ changed", () => {
    expect(listingChanged(["README.md", "src/utils/text-utils.js", "docs/architecture.md"])).toBe(false);
  });

  test("false for an empty diff", () => {
    expect(listingChanged([])).toBe(false);
  });

  test("does not false-positive on a similarly-named path", () => {
    expect(listingChanged(["docs/chrome-web-store-old/description.md"])).toBe(false);
  });
});

import { normalizeName, isSameName, formatDuration, randomBetween } from "../src/utils/text-utils.js";

describe("normalizeName / isSameName", () => {
  test("ignores case and extra whitespace", () => {
    expect(normalizeName("  Future   Processing ")).toBe("future processing");
    expect(isSameName("SoftServe", "softserve ")).toBe(true);
    expect(isSameName("Microsoft", "Microsoft Israel")).toBe(false);
  });
});

describe("formatDuration", () => {
  test.each([
    [850, "850ms"],
    [12400, "12.4s"],
    [65000, "1m 05s"],
    [-1, "0ms"],
    [NaN, "0ms"],
  ])("%p → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("randomBetween", () => {
  test("stays within bounds", () => {
    for (let i = 0; i < 100; i++) {
      const value = randomBetween(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });
});

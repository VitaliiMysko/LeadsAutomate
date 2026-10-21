import { nameFeatures, tokenOverlap, editSimilarity } from "../src/utils/name-features.js";

describe("nameFeatures", () => {
  test("exact match", () => {
    expect(nameFeatures("DotControl", "DotControl")).toEqual({
      exact: true,
      exactIgnoreCase: true,
      legalForm: true,
      startsWith: true,
      contains: true,
      tokenOverlap: 1,
      editSimilarity: 1,
    });
  });

  test("case and legal form differences", () => {
    expect(nameFeatures("Acme", "ACME GmbH")).toMatchObject({
      exact: false,
      exactIgnoreCase: false,
      legalForm: true,
      startsWith: true,
      tokenOverlap: 1,
    });
  });

  test("a longer, different name", () => {
    const features = nameFeatures("Moriyama US", "Moriyama - Umbraco Platinum Partner UK/US");
    expect(features).toMatchObject({ exact: false, legalForm: false, startsWith: false, contains: false });
    expect(features.tokenOverlap).toBeGreaterThan(0);
    expect(features.tokenOverlap).toBeLessThan(0.5);
  });
});

describe("tokenOverlap / editSimilarity", () => {
  test("token overlap ignores legal forms and punctuation", () => {
    expect(tokenOverlap("Acme Software, Inc.", "acme software")).toBe(1);
    expect(tokenOverlap("Acme Labs", "Beta Labs")).toBeCloseTo(1 / 3);
  });

  test("edit similarity", () => {
    expect(editSimilarity("Ecreo", "Ecreos")).toBeCloseTo(5 / 6);
    expect(editSimilarity("abc", "xyz")).toBe(0);
    expect(editSimilarity("", "")).toBe(1);
  });
});

import { parseCompaniesText } from "../src/utils/companies-file.js";

describe("parseCompaniesText", () => {
  test("splits on commas and trims", () => {
    expect(parseCompaniesText("Microsoft,  Google ,Apple")).toEqual(["Microsoft", "Google", "Apple"]);
  });

  test("accepts line breaks as separators", () => {
    expect(parseCompaniesText("Microsoft,\r\nGoogle\nApple,")).toEqual(["Microsoft", "Google", "Apple"]);
  });

  test("drops empty entries, quotes, BOM and repeated names", () => {
    expect(parseCompaniesText('﻿"Future  Processing", ,microsoft, Microsoft, «SoftServe»')).toEqual([
      "Future Processing",
      "microsoft",
      "SoftServe",
    ]);
  });

  test("returns an empty list for empty input", () => {
    expect(parseCompaniesText("")).toEqual([]);
    expect(parseCompaniesText(" , \n ")).toEqual([]);
    expect(parseCompaniesText(undefined)).toEqual([]);
  });
});

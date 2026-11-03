import { parseCompaniesText, hasLogoColumn } from "../src/utils/companies-file.js";

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

describe("hasLogoColumn", () => {
  test("true for a CSV with a logo column, even with empty cells", () => {
    expect(hasLogoColumn("company_name,logo\nAcme,C:\logos\acme.png")).toBe(true);
    expect(hasLogoColumn("company_name;Logo\nAcme;")).toBe(true);
  });

  test("false without a logo column, for a list of names, or an empty file", () => {
    expect(hasLogoColumn("company_name,linkedin\nAcme,")).toBe(false);
    expect(hasLogoColumn("Acme, Globex")).toBe(false);
    expect(hasLogoColumn("logo,website\nacme.png,acme.com")).toBe(false);
    expect(hasLogoColumn("")).toBe(false);
  });
});

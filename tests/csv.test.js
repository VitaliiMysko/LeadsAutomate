import { parseCsv } from "../src/utils/csv.js";
import { parseCompaniesCsv, parseCompaniesFile, logoFileKey } from "../src/utils/companies-file.js";

describe("parseCsv", () => {
  test("handles quotes, embedded delimiters, line breaks and doubled quotes", () => {
    const text = '\uFEFFa,b,c\n1,"x, y","line1\nline2"\r\n2,"say ""hi""",\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", "line1\nline2"],
      ["2", 'say "hi"', ""],
    ]);
  });

  test("detects ; as the delimiter", () => {
    expect(parseCsv("a;b\n1;2,5")).toEqual([
      ["a", "b"],
      ["1", "2,5"],
    ]);
  });

  test("drops empty rows", () => {
    expect(parseCsv("a\n\n , \nb\n")).toEqual([["a"], ["b"]]);
  });
});

describe("parseCompaniesCsv", () => {
  const csv =
    "title,company_name,Logo,website\n" +
    'x,"Acme, Inc.",C:\\logos\\acme.png,acme.com\n' +
    "x,  Beta  Ltd ,,beta.com\n" +
    "x,acme inc.,C:\\logos\\other.png,\n" +
    "x,,C:\\logos\\none.png,\n";

  test("reads company_name and logo by header name, any column order and case", () => {
    expect(parseCompaniesCsv(csv)).toEqual([
      { name: "Acme, Inc.", logoPath: "C:\\logos\\acme.png" },
      { name: "Beta Ltd", logoPath: null },
      { name: "acme inc.", logoPath: "C:\\logos\\other.png" },
    ]);
  });

  test("logo column is optional", () => {
    expect(parseCompaniesCsv("company_name\nAcme\nBeta")).toEqual([
      { name: "Acme", logoPath: null },
      { name: "Beta", logoPath: null },
    ]);
  });

  test("null without a company_name column", () => {
    expect(parseCompaniesCsv("title,logo\nAcme,x.png")).toBeNull();
    expect(parseCompaniesCsv("")).toBeNull();
  });
});

describe("parseCompaniesFile", () => {
  test("CSV with company_name", () => {
    expect(parseCompaniesFile("company_name,logo\nAcme,a.png")).toEqual([{ name: "Acme", logoPath: "a.png" }]);
  });

  test("plain comma-separated list otherwise", () => {
    expect(parseCompaniesFile("Acme, Beta\nGamma")).toEqual([
      { name: "Acme", logoPath: null },
      { name: "Beta", logoPath: null },
      { name: "Gamma", logoPath: null },
    ]);
  });
});

describe("logoFileKey", () => {
  test.each([
    ["C:\\Users\\me\\umbraco partners logo\\Acme.PNG", "acme.png"],
    ["/home/me/logos/acme.png", "acme.png"],
    ["acme.png", "acme.png"],
  ])("%s → %s", (path, expected) => {
    expect(logoFileKey(path)).toBe(expected);
  });
});

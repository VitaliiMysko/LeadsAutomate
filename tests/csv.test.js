import { parseCsv } from "../src/utils/csv.js";
import { parseCompaniesCsv, parseCompaniesFile, parseCompanyId, logoFileKey } from "../src/utils/companies-file.js";

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
    "title,company_name,Logo,website,Country\n" +
    'x,"Acme, Inc.",C:\\logos\\acme.png,acme.com,Austria\n' +
    "x,  Beta  Ltd ,,beta.com,\n" +
    "x,acme inc.,C:\\logos\\other.png,,\n" +
    "x,,C:\\logos\\none.png,,\n";

  test("reads company_name, logo, website and country by header name, any column order and case", () => {
    expect(parseCompaniesCsv(csv)).toEqual([
      { name: "Acme, Inc.", companyId: null, rawCompanyId: null, logoPath: "C:\\logos\\acme.png", website: "acme.com", country: "Austria" },
      { name: "Beta Ltd", companyId: null, rawCompanyId: null, logoPath: null, website: "beta.com", country: null },
      { name: "acme inc.", companyId: null, rawCompanyId: null, logoPath: "C:\\logos\\other.png", website: null, country: null },
    ]);
  });

  test("logo, website and country columns are optional", () => {
    expect(parseCompaniesCsv("company_name\nAcme\nBeta")).toEqual([
      { name: "Acme", companyId: null, rawCompanyId: null, logoPath: null, website: null, country: null },
      { name: "Beta", companyId: null, rawCompanyId: null, logoPath: null, website: null, country: null },
    ]);
  });

  test("null without a company_name or company_id column", () => {
    expect(parseCompaniesCsv("title,logo\nAcme,x.png")).toBeNull();
    expect(parseCompaniesCsv("")).toBeNull();
  });

  test("reads company_id; names id-only rows by their id; keeps unreadable ids raw", () => {
    const text =
      "company_name,Company_ID\n" +
      "Acme,2781504\n" +
      "Beta,https://www.linkedin.com/company/beta-ltd/\n" +
      ",urn:li:organization:42\n" +
      "Gamma,\n";
    expect(parseCompaniesCsv(text).map(({ name, companyId, rawCompanyId }) => ({ name, companyId, rawCompanyId }))).toEqual([
      { name: "Acme", companyId: "2781504", rawCompanyId: "2781504" },
      { name: "Beta", companyId: null, rawCompanyId: "https://www.linkedin.com/company/beta-ltd/" },
      { name: "42", companyId: "42", rawCompanyId: "urn:li:organization:42" },
      { name: "Gamma", companyId: null, rawCompanyId: null },
    ]);
  });

  test("a company_id column alone is enough", () => {
    expect(parseCompaniesCsv("company_id\n7\n\n8").map((company) => company.name)).toEqual(["7", "8"]);
  });

  test("dedupes by company id when there is one, else by name", () => {
    const text = "company_name,company_id\nAcme,1\nAcme,2\nAcme Again,1\nBeta,\nbeta,\n";
    expect(parseCompaniesCsv(text).map(({ name, companyId }) => [name, companyId])).toEqual([
      ["Acme", "1"],
      ["Acme", "2"],
      ["Beta", null],
    ]);
  });
});

describe("parseCompanyId", () => {
  test.each([
    ["2781504", "2781504"],
    [" 2781504 ", "2781504"],
    ["urn:li:organization:2781504", "2781504"],
    ["urn:li:fs_salesCompany:2781504", "2781504"],
    ["https://www.linkedin.com/company/2781504/", "2781504"],
    ["https://www.linkedin.com/company/2781504/about/", "2781504"],
    ["https://www.linkedin.com/sales/company/2781504?_ntb=x", "2781504"],
    ["linkedin.com/company/2781504", "2781504"],
    ["https://www.linkedin.com/company/acme/", null],
    ["https://www.linkedin.com/company/3m", null],
    ["https://example.com/company/123", null],
    ["12a", null],
    ["", null],
    [null, null],
  ])("%s → %s", (value, expected) => {
    expect(parseCompanyId(value)).toBe(expected);
  });
});

describe("parseCompaniesFile", () => {
  test("CSV with company_name", () => {
    expect(parseCompaniesFile("company_name,logo\nAcme,a.png")).toEqual([
      { name: "Acme", companyId: null, rawCompanyId: null, logoPath: "a.png", website: null, country: null },
    ]);
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

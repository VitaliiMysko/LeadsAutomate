import { parseCsv } from "../src/utils/csv.js";
import {
  parseCompaniesCsv,
  parseCompaniesFile,
  parseCompanyId,
  logoFileKey,
  companiesCsvColumns,
  columnMappingLines,
} from "../src/utils/companies-file.js";

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

  test("reads company_name and logo by header name, any column order and case; ignores other columns", () => {
    expect(parseCompaniesCsv(csv)).toEqual([
      { name: "Acme, Inc.", companyId: null, rawCompanyId: null, logoPath: "C:\\logos\\acme.png", linkedin: null, nameFromPage: false },
      { name: "Beta Ltd", companyId: null, rawCompanyId: null, logoPath: null, linkedin: null, nameFromPage: false },
      { name: "acme inc.", companyId: null, rawCompanyId: null, logoPath: "C:\\logos\\other.png", linkedin: null, nameFromPage: false },
    ]);
  });

  test("logo and linkedin columns are optional", () => {
    expect(parseCompaniesCsv("company_name\nAcme\nBeta")).toEqual([
      { name: "Acme", companyId: null, rawCompanyId: null, logoPath: null, linkedin: null, nameFromPage: false },
      { name: "Beta", companyId: null, rawCompanyId: null, logoPath: null, linkedin: null, nameFromPage: false },
    ]);
  });

  test("null without a company_id, linkedin or company_name column", () => {
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

  test("takes the id from a linkedin URL with the number when company_id is empty", () => {
    const text =
      "company_name,company_id,LinkedIn\n" +
      "Acme,,https://www.linkedin.com/company/2781504/\n" +
      "Beta,,https://www.linkedin.com/company/beta-ltd/\n" +
      "Gamma,7,https://www.linkedin.com/company/8/\n";
    expect(parseCompaniesCsv(text).map(({ name, companyId, linkedin }) => ({ name, companyId, linkedin }))).toEqual([
      { name: "Acme", companyId: "2781504", linkedin: "https://www.linkedin.com/company/2781504/" },
      { name: "Beta", companyId: null, linkedin: "https://www.linkedin.com/company/beta-ltd/" },
      { name: "Gamma", companyId: "7", linkedin: "https://www.linkedin.com/company/8/" },
    ]);
  });

  test("a company_id column alone is enough", () => {
    expect(parseCompaniesCsv("company_id\n7\n\n8").map((company) => company.name)).toEqual(["7", "8"]);
  });

  test("a linkedin column alone is enough; rows without a name are named by the page", () => {
    const text =
      "LinkedIn\n" +
      "https://www.linkedin.com/company/thisistangent/\n" +
      "https://www.linkedin.com/company/2781504/\n" +
      "not a page\n";
    expect(parseCompaniesCsv(text).map(({ name, companyId, nameFromPage }) => [name, companyId, nameFromPage])).toEqual([
      ["thisistangent", null, true],
      ["2781504", "2781504", false],
    ]);
  });

  test("dedupes by company id when there is one, else by LinkedIn page, else by name", () => {
    const text =
      "company_name,company_id,linkedin\n" +
      "Acme,1,\nAcme,2,\nAcme Again,1,\nBeta,,\nbeta,,\n" +
      "Gamma,,https://www.linkedin.com/company/gamma/\n" +
      "Gamma UK,,https://uk.linkedin.com/company/Gamma\n" +
      "Gamma,,https://www.linkedin.com/company/gamma-uk/\n";
    expect(parseCompaniesCsv(text).map(({ name, companyId }) => [name, companyId])).toEqual([
      ["Acme", "1"],
      ["Acme", "2"],
      ["Beta", null],
      ["Gamma", null],
      ["Gamma", null],
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
      { name: "Acme", companyId: null, rawCompanyId: null, logoPath: "a.png", linkedin: null, nameFromPage: false },
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

describe("companiesCsvColumns", () => {
  test("maps the columns read as parseCompaniesCsv does, keeping the file's spelling", () => {
    expect(companiesCsvColumns(" Company_name ;Address;Linkedin;Company_id;logo;LOGO\nAcme;x;y;1;a.png;b.png")).toEqual({
      mapped: [
        { field: "company_id", column: "Company_id" },
        { field: "linkedin", column: "Linkedin" },
        { field: "company_name", column: "Company_name" },
        { field: "logo", column: "logo" },
      ],
      missing: [],
      ignored: ["Address", "LOGO"],
    });
  });

  test("null for an empty file", () => {
    expect(companiesCsvColumns("")).toBeNull();
  });
});

describe("columnMappingLines", () => {
  test("found names the columns only; lines also list the file's spelling, missing and ignored columns", () => {
    expect(columnMappingLines(companiesCsvColumns("Company_Name,Country,Logo\nAcme,AT,a.png"))).toEqual({
      found: ["Columns found: company_name, logo."],
      lines: [
        'Column mapping found: "Company_Name" → company_name, "Logo" → logo.',
        "Not in the file: company_id, linkedin.",
        'Ignored columns: "Country".',
      ],
      readAsList: false,
    });
    expect(columnMappingLines(companiesCsvColumns("company_name,Country,Phone\nAcme,AT,1"))).toMatchObject({
      lines: [
        'Column mapping found: "company_name" → company_name.',
        "Not in the file: company_id, linkedin, logo.",
        'Ignored columns: "Country", "Phone".',
      ],
      readAsList: false,
    });
  });

  test("says when the file is read as a plain list", () => {
    const { found, lines, readAsList } = columnMappingLines(companiesCsvColumns("project name,company id,logo\nAVS,1,a.png"));
    expect(readAsList).toBe(true);
    expect(found[0]).toBe("Columns found: logo.");
    expect(found.at(-1)).toMatch(/no company_id, linkedin or company_name column/);
    expect(lines[0]).toBe('Column mapping found: "logo" → logo.');
    expect(lines.at(-1)).toMatch(/no company_id, linkedin or company_name column/);
  });

  test("a linkedin column alone isn't read as a list", () => {
    expect(columnMappingLines(companiesCsvColumns("linkedin,x\nhttps://www.linkedin.com/company/a/,1"))).toMatchObject({
      found: ["Columns found: linkedin."],
      readAsList: false,
    });
  });

  test("none found", () => {
    const { found, lines } = columnMappingLines(companiesCsvColumns("a,b\n1,2"));
    expect(found[0]).toBe("Columns found: none.");
    expect(lines[0]).toBe("Column mapping found: none.");
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

import { parseCsv, toCsv } from "../src/utils/csv.js";
import {
  searchKeyOf,
  newCompanyExport,
  takeCompanies,
  exportComplete,
  canContinueExport,
  companiesCsv,
  restoreCompanyExport,
  resultNumber,
} from "../src/utils/company-export.js";
import { parseCompaniesCsv } from "../src/utils/companies-file.js";
import { isCompanySearchUrl, isPeopleSearchUrl } from "../src/utils/restli-query.js";

const SEARCH = "https://www.linkedin.com/sales/search/company?query=(filters:List((type:INDUSTRY)))&sessionId=abc";
const row = (index, id, name = `Company ${id}`) => ({
  index,
  name,
  href: id ? `https://www.linkedin.com/sales/company/${id}?_ntb=x` : "",
});

describe("isCompanySearchUrl", () => {
  test("tells the company search from the people search", () => {
    expect(isCompanySearchUrl(SEARCH)).toBe(true);
    expect(isPeopleSearchUrl(SEARCH)).toBe(false);
    expect(isCompanySearchUrl("https://www.linkedin.com/sales/search/people?query=()")).toBe(false);
  });
});

describe("toCsv", () => {
  test("quotes only the fields that need it and reads back", () => {
    const rows = [
      ["a", "b"],
      ["1", 'say "hi", ok'],
      ["2", "x;y"],
      ["3", " padded"],
    ];
    const text = toCsv(rows);
    expect(text).toBe('a,b\r\n1,"say ""hi"", ok"\r\n2,"x;y"\r\n3," padded"\r\n');
    expect(parseCsv(text)).toEqual(rows);
  });
});

describe("searchKeyOf", () => {
  test("ignores the page and the session id", () => {
    expect(searchKeyOf(`${SEARCH}&page=3`)).toBe(searchKeyOf(SEARCH.replace("abc", "def")));
  });

  test("differs between searches", () => {
    expect(searchKeyOf(SEARCH)).not.toBe(searchKeyOf(SEARCH.replace("INDUSTRY", "REGION")));
  });

  test("is null for a non-URL", () => {
    expect(searchKeyOf("nope")).toBeNull();
  });
});

describe("newCompanyExport", () => {
  test("starts on the page shown, keeping the search URL without it", () => {
    const state = newCompanyExport(`${SEARCH}&page=2`, 50);
    expect(state).toMatchObject({ target: 50, page: 2, companies: [], last: null, done: false });
    expect(state.searchUrl).not.toContain("page=");
  });
});

describe("takeCompanies", () => {
  const start = newCompanyExport(SEARCH, 5);

  test("takes the companies in order with their ids and the last one", () => {
    const { state, added, unread } = takeCompanies(start, [row(0, "11"), row(1, "12", "  Acme \n GmbH ")], 1);
    expect(added).toEqual([
      { id: "11", name: "Company 11" },
      { id: "12", name: "Acme GmbH" },
    ]);
    expect(state.last).toEqual({ id: "12", name: "Acme GmbH", page: 1, index: 1 });
    expect(unread).toBeNull();
  });

  test("stops at the target", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((index) => row(index, String(100 + index)));
    const { state } = takeCompanies(start, rows, 1);
    expect(state.companies.map((company) => company.id)).toEqual(["100", "101", "102", "103", "104"]);
    expect(exportComplete(state)).toBe(true);
    expect(canContinueExport(state)).toBe(false);
  });

  test("stops at a row that didn't render, keeping the ones before it", () => {
    const { state, unread } = takeCompanies(start, [row(0, "1"), row(1, ""), row(2, "3")], 4);
    expect(state.companies.map((company) => company.id)).toEqual(["1"]);
    expect(state.last).toMatchObject({ id: "1", page: 4, index: 0 });
    expect(unread).toBe(1);
  });

  test("skips companies already taken, so a page can be read again on continue", () => {
    const first = takeCompanies(start, [row(0, "1"), row(1, "")], 1).state;
    const { state, added } = takeCompanies(first, [row(0, "1"), row(1, "2"), row(2, "3")], 1);
    expect(added.map((company) => company.id)).toEqual(["2", "3"]);
    expect(state.companies).toHaveLength(3);
    expect(state.last.index).toBe(2);
  });

  test("keeps `last` when nothing new is taken", () => {
    const first = takeCompanies(start, [row(0, "1")], 1).state;
    expect(takeCompanies(first, [row(0, "1")], 1).state.last).toEqual(first.last);
  });
});

describe("resultNumber", () => {
  test("numbers the companies across the pages", () => {
    expect(resultNumber(1, 0)).toBe(1);
    expect(resultNumber(2, 0)).toBe(26);
    expect(resultNumber(3, 24)).toBe(75);
  });
});

describe("companiesCsv", () => {
  test("writes company_id and company_name, readable as a companies file", () => {
    const text = companiesCsv([
      { id: "2781504", name: "Moriyama, Inc." },
      { id: "42", name: "Tangent" },
    ]);
    expect(text.split("\r\n")[0]).toBe("company_id,company_name");
    expect(parseCompaniesCsv(text).map(({ name, companyId }) => ({ name, companyId }))).toEqual([
      { name: "Moriyama, Inc.", companyId: "2781504" },
      { name: "Tangent", companyId: "42" },
    ]);
  });
});

describe("restoreCompanyExport", () => {
  test("keeps a stored state", () => {
    const state = takeCompanies(newCompanyExport(SEARCH, 30), [row(0, "7")], 1).state;
    expect(restoreCompanyExport(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  test("drops anything else", () => {
    expect(restoreCompanyExport(null)).toBeNull();
    expect(restoreCompanyExport({ companies: [] })).toBeNull();
  });

  test("drops malformed companies", () => {
    const restored = restoreCompanyExport({ searchUrl: SEARCH, companies: [{ id: "1", name: "A" }, { name: "B" }, null] });
    expect(restored.companies).toEqual([{ id: "1", name: "A" }]);
  });
});

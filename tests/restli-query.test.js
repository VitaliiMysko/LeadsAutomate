import {
  parseRestli,
  serializeRestli,
  urlWithoutFilter,
  urlWithCompany,
  getSearchFilters,
  getFilterValues,
  getFilterTexts,
  isPeopleSearchUrl,
  isLeadUrl,
  pageOf,
  urlWithPage,
  companyIdFromUrn,
  FILTER_TYPES,
  SELECTION_TYPES,
} from "../src/utils/restli-query.js";

// Builds a people-search URL the way Sales Navigator does: values inside the
// Rest.li query are percent-encoded, then the whole query is encoded again.
function searchUrl(query) {
  return `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(query)}&sessionId=abc`;
}

const enc = encodeURIComponent;

describe("parseRestli", () => {
  test("parses nested objects, lists and scalars", () => {
    expect(parseRestli("(a:1,b:List(x,y),c:(d:true))")).toEqual({ a: "1", b: ["x", "y"], c: { d: "true" } });
  });

  test("decodes percent-encoded scalars", () => {
    expect(parseRestli(`(text:${enc("Chief Technology Officer, CTO")})`)).toEqual({
      text: "Chief Technology Officer, CTO",
    });
  });

  test("handles empty lists and objects", () => {
    expect(parseRestli("(a:List(),b:())")).toEqual({ a: [], b: {} });
  });

  test("throws on unbalanced input", () => {
    expect(() => parseRestli("(a:List(x,y)")).toThrow();
    expect(() => parseRestli("(a:1))")).toThrow();
  });
});

describe("getSearchFilters / getFilterTexts", () => {
  const query =
    "(recentSearchParam:(id:123,doLogHistory:true),filters:List(" +
    `(type:CURRENT_TITLE,values:List((id:8,text:${enc("Chief Technology Officer")},selectionType:INCLUDED),` +
    `(text:${enc("Head of R&D")},selectionType:INCLUDED),` +
    `(id:9,text:Intern,selectionType:EXCLUDED))),` +
    `(type:CURRENT_COMPANY,values:List((id:${enc("urn:li:organization:1035")},text:${enc("Microsoft")},selectionType:INCLUDED)))` +
    "))";

  test("reads filters from a Sales Navigator URL", () => {
    const filters = getSearchFilters(searchUrl(query));
    expect(filters.map((filter) => filter.type)).toEqual(["CURRENT_TITLE", "CURRENT_COMPANY"]);
    expect(filters[1].values[0]).toEqual({
      id: "urn:li:organization:1035",
      text: "Microsoft",
      selectionType: "INCLUDED",
    });
  });

  test("returns included texts of one type only", () => {
    expect(getFilterTexts(searchUrl(query), FILTER_TYPES.CURRENT_TITLE)).toEqual([
      "Chief Technology Officer",
      "Head of R&D",
    ]);
    expect(getFilterTexts(searchUrl(query), FILTER_TYPES.CURRENT_TITLE, SELECTION_TYPES.EXCLUDED)).toEqual(["Intern"]);
    expect(getFilterTexts(searchUrl(query), FILTER_TYPES.CURRENT_COMPANY)).toEqual(["Microsoft"]);
  });

  test("getFilterValues keeps ids, so free text (no id) can be told apart", () => {
    expect(getFilterValues(searchUrl(query), FILTER_TYPES.CURRENT_TITLE)).toEqual([
      { id: "8", text: "Chief Technology Officer", selectionType: "INCLUDED" },
      { id: null, text: "Head of R&D", selectionType: "INCLUDED" },
    ]);
    expect(getFilterValues(searchUrl(query), FILTER_TYPES.CURRENT_TITLE, SELECTION_TYPES.EXCLUDED)).toEqual([
      { id: "9", text: "Intern", selectionType: "EXCLUDED" },
    ]);
  });

  test("returns null without a parsable query", () => {
    expect(getSearchFilters("https://www.linkedin.com/sales/search/people?savedSearchId=5")).toBeNull();
    expect(getSearchFilters(searchUrl("(filters:List(("))).toBeNull();
    expect(getSearchFilters("not a url")).toBeNull();
    expect(getFilterTexts("https://www.linkedin.com/sales/search/people", FILTER_TYPES.CURRENT_TITLE)).toEqual([]);
  });

  test("a query without filters yields an empty list", () => {
    expect(getSearchFilters(searchUrl("(spellCorrectionEnabled:true,keywords:java)"))).toEqual([]);
  });
});

describe("serializeRestli", () => {
  test("round-trips through parseRestli", () => {
    const value = {
      recentSearchParam: { id: "123", doLogHistory: "true" },
      filters: [
        { type: "CURRENT_COMPANY", values: [{ id: "urn:li:organization:1035", text: "Moriyama - Umbraco UK/US, Ltd (x)", selectionType: "INCLUDED" }] },
      ],
      keywords: "",
      empty: [],
    };
    expect(parseRestli(serializeRestli(value))).toEqual(value);
  });

  test("encodes reserved characters inside scalars", () => {
    expect(serializeRestli({ text: "A, B (C): D" })).toBe("(text:A%2C%20B%20%28C%29%3A%20D)");
  });
});

describe("urlWithoutFilter", () => {
  const query =
    "(recentSearchParam:(id:123,doLogHistory:true),filters:List(" +
    `(type:CURRENT_TITLE,values:List((id:8,text:${enc("Chief Technology Officer")},selectionType:INCLUDED))),` +
    `(type:CURRENT_COMPANY,values:List((id:${enc("urn:li:organization:1")},text:${enc("Moriyama - Umbraco Platinum Partner UK/US")},selectionType:INCLUDED),` +
    `(text:Acme,selectionType:EXCLUDED)))` +
    "))";

  test("drops every value of the filter and keeps the rest of the search", () => {
    const url = urlWithoutFilter(searchUrl(query), FILTER_TYPES.CURRENT_COMPANY);
    expect(getFilterTexts(url, FILTER_TYPES.CURRENT_COMPANY)).toEqual([]);
    expect(getFilterTexts(url, FILTER_TYPES.CURRENT_COMPANY, SELECTION_TYPES.EXCLUDED)).toEqual([]);
    expect(getFilterTexts(url, FILTER_TYPES.CURRENT_TITLE)).toEqual(["Chief Technology Officer"]);
    expect(getSearchFilters(url).map((filter) => filter.type)).toEqual(["CURRENT_TITLE"]);
    expect(new URL(url).searchParams.get("sessionId")).toBe("abc");
    expect(new URL(url).pathname).toBe("/sales/search/people");
  });

  test("returns null without a parsable query", () => {
    expect(urlWithoutFilter("https://www.linkedin.com/sales/search/people?savedSearchId=5", "CURRENT_COMPANY")).toBeNull();
    expect(urlWithoutFilter("not a url", "CURRENT_COMPANY")).toBeNull();
  });
});

describe("urlWithCompany", () => {
  const query =
    "(recentSearchParam:(id:123,doLogHistory:true),filters:List(" +
    `(type:CURRENT_TITLE,values:List((id:8,text:${enc("Chief Technology Officer")},selectionType:INCLUDED))),` +
    `(type:CURRENT_COMPANY,values:List((id:${enc("urn:li:organization:1")},text:Old,selectionType:INCLUDED),` +
    `(text:Acme,selectionType:EXCLUDED)))` +
    "))";

  test("replaces every company value with the one company, keeping the rest of the search", () => {
    const url = urlWithCompany(searchUrl(query), "2781504", "Acme, Inc. (UK)");
    expect(getFilterValues(url, FILTER_TYPES.CURRENT_COMPANY)).toEqual([
      { id: "urn:li:organization:2781504", text: "Acme, Inc. (UK)", selectionType: SELECTION_TYPES.INCLUDED },
    ]);
    expect(getFilterTexts(url, FILTER_TYPES.CURRENT_COMPANY, SELECTION_TYPES.EXCLUDED)).toEqual([]);
    expect(getFilterTexts(url, FILTER_TYPES.CURRENT_TITLE)).toEqual(["Chief Technology Officer"]);
    expect(getSearchFilters(url).map((filter) => filter.type)).toEqual(["CURRENT_TITLE", "CURRENT_COMPANY"]);
    expect(new URL(url).searchParams.get("sessionId")).toBe("abc");
  });

  test("adds the company filter when the search has none", () => {
    const url = urlWithCompany(searchUrl("(filters:List())"), "5", "Beta");
    expect(getFilterValues(url, FILTER_TYPES.CURRENT_COMPANY)).toEqual([
      { id: "urn:li:organization:5", text: "Beta", selectionType: SELECTION_TYPES.INCLUDED },
    ]);
    expect(getFilterValues(urlWithCompany(searchUrl("()"), "5", "Beta"), FILTER_TYPES.CURRENT_COMPANY)).toHaveLength(1);
  });

  test("returns null without a parsable query", () => {
    expect(urlWithCompany("https://www.linkedin.com/sales/search/people?savedSearchId=5", "1", "A")).toBeNull();
    expect(urlWithCompany("not a url", "1", "A")).toBeNull();
  });
});

describe("isPeopleSearchUrl", () => {
  test.each([
    ["https://www.linkedin.com/sales/search/people?query=()", true],
    ["https://www.linkedin.com/sales/search/people", true],
    ["https://www.linkedin.com/sales/search/company?query=()", false],
    ["https://www.linkedin.com/sales/lead/ACwAA,NAME", false],
    [undefined, false],
  ])("%s → %s", (url, expected) => {
    expect(isPeopleSearchUrl(url)).toBe(expected);
  });
});

describe("isLeadUrl", () => {
  test.each([
    ["https://www.linkedin.com/sales/lead/ACwAA,NAME_SEARCH,x1y2", true],
    ["https://www.linkedin.com/sales/search/people?query=()", false],
    ["https://www.linkedin.com/in/someone/", false],
    [undefined, false],
  ])("%s → %s", (url, expected) => {
    expect(isLeadUrl(url)).toBe(expected);
  });
});

describe("pageOf / urlWithPage", () => {
  const base = "https://www.linkedin.com/sales/search/people?query=(a%3A1)&sessionId=abc";

  test("reads the page parameter, 1 without it or when invalid", () => {
    expect(pageOf(base)).toBe(1);
    expect(pageOf(`${base}&page=3`)).toBe(3);
    expect(pageOf(`${base}&page=0`)).toBe(1);
    expect(pageOf(`${base}&page=x`)).toBe(1);
    expect(pageOf("not a url")).toBe(1);
  });

  test("sets the page, keeping the query, and drops it for page 1", () => {
    const second = urlWithPage(base, 2);
    expect(pageOf(second)).toBe(2);
    expect(new URL(second).searchParams.get("query")).toBe("(a:1)");
    expect(new URL(second).searchParams.get("sessionId")).toBe("abc");
    expect(new URL(urlWithPage(second, 1)).searchParams.has("page")).toBe(false);
    expect(urlWithPage("not a url", 2)).toBeNull();
  });
});

describe("companyIdFromUrn", () => {
  test.each([
    ["urn:li:organization:2781504", "2781504"],
    ["urn:li:company:200346", "200346"],
    ["98943645", "98943645"],
    [null, null],
    ["", null],
  ])("%p → %p", (urn, expected) => {
    expect(companyIdFromUrn(urn)).toBe(expected);
  });
});

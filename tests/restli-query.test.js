import {
  parseRestli,
  getSearchFilters,
  getFilterTexts,
  isPeopleSearchUrl,
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

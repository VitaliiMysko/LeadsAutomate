import { isRateLimitResponse } from "../src/utils/rate-limit.js";

describe("isRateLimitResponse", () => {
  test.each([
    ["https://www.linkedin.com/sales-api/salesApiLeadSearch?q=searchQuery", 429, true],
    ["https://www.linkedin.com/sales/search/people?query=()", 429, true],
    ["https://www.linkedin.com/sales-api/salesApiLeadSearch?q=searchQuery", 200, false],
    ["https://www.linkedin.com/sales/lead/ACwAA,NAME_SEARCH", 403, false],
    // Not Sales Navigator: the public company pages have limits of their own.
    ["https://www.linkedin.com/company/umbraco/", 429, false],
    ["https://www.linkedin.com/salesforce/", 429, false],
    ["https://media.licdn.com/dms/image/logo.png", 429, false],
  ])("%s answered %i → %s", (url, statusCode, expected) => {
    expect(isRateLimitResponse({ url, statusCode })).toBe(expected);
  });

  test("tolerates missing details", () => {
    expect(isRateLimitResponse(undefined)).toBe(false);
    expect(isRateLimitResponse({ statusCode: 429 })).toBe(false);
  });
});

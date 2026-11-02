// LinkedIn answers HTTP 429 (Too Many Requests) to Sales Navigator once the
// account's daily request limit is used up; the page then shows "Too many
// requests". The status code says it in every interface language.

export const TOO_MANY_REQUESTS = 429;

// Sales Navigator's pages (/sales/...) and the API they load data from
// (/sales-api/...).
const SALES_NAVIGATOR_REQUEST = /^https:\/\/www\.linkedin\.com\/sales(-api)?\//;

// Whether a completed request (chrome.webRequest details: { url, statusCode })
// is Sales Navigator refusing it for too many requests.
export function isRateLimitResponse(details) {
  return details?.statusCode === TOO_MANY_REQUESTS && SALES_NAVIGATOR_REQUEST.test(details.url ?? "");
}

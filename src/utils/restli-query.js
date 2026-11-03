// Sales Navigator keeps the whole search state in the `query` URL parameter,
// encoded in Rest.li protocol syntax, e.g.
//   (filters:List((type:CURRENT_TITLE,values:List((id:8,text:CTO,selectionType:INCLUDED)))))
// Reading filters from the URL is language-independent and immune to
// LinkedIn's hashed CSS class names, unlike scraping the filter panel.

const PEOPLE_SEARCH_URL_REGEX = /^https:\/\/www\.linkedin\.com\/sales\/search\/people/;
const COMPANY_SEARCH_URL_REGEX = /^https:\/\/www\.linkedin\.com\/sales\/search\/company/;
const LEAD_URL_REGEX = /^https:\/\/www\.linkedin\.com\/sales\/lead\//;

export const FILTER_TYPES = {
  CURRENT_TITLE: "CURRENT_TITLE",
  CURRENT_COMPANY: "CURRENT_COMPANY",
};

export const SELECTION_TYPES = {
  INCLUDED: "INCLUDED",
  EXCLUDED: "EXCLUDED",
};

export function isPeopleSearchUrl(url) {
  return typeof url === "string" && PEOPLE_SEARCH_URL_REGEX.test(url);
}

// Sales Navigator's account (company) search: its results are companies.
export function isCompanySearchUrl(url) {
  return typeof url === "string" && COMPANY_SEARCH_URL_REGEX.test(url);
}

// A lead's page (linkedin.com/sales/lead/...), also shown over the search
// results when a lead is opened from them.
export function isLeadUrl(url) {
  return typeof url === "string" && LEAD_URL_REGEX.test(url);
}

function decode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Parses a Rest.li-encoded value: `(key:value,...)` objects, `List(...)`
// lists and percent-encoded scalars. Throws on malformed input.
export function parseRestli(text) {
  let pos = 0;

  function expectEnd() {
    throw new Error(`Unexpected character "${text[pos] ?? "end of input"}" at ${pos}`);
  }

  function parseItems() {
    const items = [];
    if (text[pos] === ")") {
      pos++;
      return items;
    }
    while (pos < text.length) {
      items.push(parseValue());
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      if (text[pos] === ")") {
        pos++;
        return items;
      }
      expectEnd();
    }
    expectEnd();
  }

  function parseObject() {
    const object = {};
    if (text[pos] === ")") {
      pos++;
      return object;
    }
    while (pos < text.length) {
      const colon = text.indexOf(":", pos);
      if (colon === -1) expectEnd();
      const key = decode(text.slice(pos, colon));
      pos = colon + 1;
      object[key] = parseValue();
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      if (text[pos] === ")") {
        pos++;
        return object;
      }
      expectEnd();
    }
    expectEnd();
  }

  function parseScalar() {
    let end = pos;
    while (end < text.length && text[end] !== "," && text[end] !== ")") end++;
    const raw = text.slice(pos, end);
    pos = end;
    return decode(raw);
  }

  function parseValue() {
    if (text.startsWith("List(", pos)) {
      pos += 5;
      return parseItems();
    }
    if (text[pos] === "(") {
      pos++;
      return parseObject();
    }
    return parseScalar();
  }

  const value = parseValue();
  if (pos !== text.length) expectEnd();
  return value;
}

// encodeURIComponent leaves parentheses alone, but they delimit Rest.li values.
function encodeScalar(value) {
  return encodeURIComponent(String(value ?? "")).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// Inverse of parseRestli: objects as `(key:value,...)`, arrays as
// `List(...)`, scalars percent-encoded.
export function serializeRestli(value) {
  if (Array.isArray(value)) return `List(${value.map(serializeRestli).join(",")})`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => `${encodeScalar(key)}:${serializeRestli(item)}`);
    return `(${entries.join(",")})`;
  }
  return encodeScalar(value);
}

// The same search URL with every value of one filter type removed, or null
// when the URL has no parsable query. Opening it is how a filter is cleared:
// Sales Navigator ignores script-generated clicks on its remove buttons.
export function urlWithoutFilter(url, type) {
  let parsedUrl;
  let parsed;
  try {
    parsedUrl = new URL(url);
    parsed = parseRestli(parsedUrl.searchParams.get("query") ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  if (Array.isArray(parsed.filters)) {
    parsed.filters = parsed.filters.filter((filter) => filter?.type !== type);
  }
  parsedUrl.searchParams.set("query", serializeRestli(parsed));
  return parsedUrl.toString();
}

// URN of a company in the "Current company" filter, from its numeric id.
export function companyUrn(companyId) {
  return `urn:li:organization:${companyId}`;
}

// The same search URL with "Current company" set to just the company with
// LinkedIn id `companyId` (included), shown as `text`, or null when the URL
// has no parsable query. The id alone decides the company; `text` is only
// the label of the selected value. The value has the shape Sales Navigator
// writes when a company is picked from the typeahead.
export function urlWithCompany(url, companyId, text) {
  let parsedUrl;
  let parsed;
  try {
    parsedUrl = new URL(url);
    parsed = parseRestli(parsedUrl.searchParams.get("query") ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const value = { id: companyUrn(companyId), text, selectionType: SELECTION_TYPES.INCLUDED };
  const filters = Array.isArray(parsed.filters) ? parsed.filters : [];
  const existing = filters.find((filter) => filter?.type === FILTER_TYPES.CURRENT_COMPANY);
  parsed.filters = existing
    ? filters
        .filter((filter) => filter === existing || filter?.type !== FILTER_TYPES.CURRENT_COMPANY)
        .map((filter) => (filter === existing ? { ...filter, values: [value] } : filter))
    : [...filters, { type: FILTER_TYPES.CURRENT_COMPANY, values: [value] }];
  parsedUrl.searchParams.set("query", serializeRestli(parsed));
  return parsedUrl.toString();
}

// Returns the search's filters as [{ type, values: [{ id, text, selectionType }] }],
// or null when the URL carries no parsable `query` (e.g. a saved search
// opened by id, before any filter is touched).
export function getSearchFilters(url) {
  let query;
  try {
    query = new URL(url).searchParams.get("query");
  } catch {
    return null;
  }
  if (!query) return null;

  let parsed;
  try {
    parsed = parseRestli(query);
  } catch {
    return null;
  }

  const filters = Array.isArray(parsed?.filters) ? parsed.filters : [];
  return filters
    .filter((filter) => filter && typeof filter.type === "string")
    .map((filter) => ({
      type: filter.type,
      values: (Array.isArray(filter.values) ? filter.values : [])
        .filter((value) => value && typeof value.text === "string")
        .map((value) => ({
          id: value.id ?? null,
          text: value.text,
          selectionType: value.selectionType ?? SELECTION_TYPES.INCLUDED,
        })),
    }));
}

// Values ({ id, text, selectionType }) of one filter type with the given
// selection type, in URL order. A value picked from the typeahead carries
// LinkedIn's id (e.g. urn:li:organization:123); free text has none.
export function getFilterValues(url, type, selectionType = SELECTION_TYPES.INCLUDED) {
  return (getSearchFilters(url) || [])
    .filter((filter) => filter.type === type)
    .flatMap((filter) => filter.values)
    .filter((value) => value.selectionType === selectionType);
}

// Unique texts of one filter type with the given selection type, in URL order.
export function getFilterTexts(url, type, selectionType = SELECTION_TYPES.INCLUDED) {
  const filters = getSearchFilters(url) || [];
  const texts = [];
  for (const filter of filters) {
    if (filter.type !== type) continue;
    for (const value of filter.values) {
      if (value.selectionType === selectionType && !texts.includes(value.text)) {
        texts.push(value.text);
      }
    }
  }
  return texts;
}

// The results page the search URL shows (its `page` parameter), 1 when it
// has none.
export function pageOf(url) {
  try {
    const page = Number(new URL(url).searchParams.get("page"));
    return Number.isInteger(page) && page > 1 ? page : 1;
  } catch {
    return 1;
  }
}

// The same search URL on results page `page`, or null when it isn't a URL.
// Page 1 has no `page` parameter, like Sales Navigator's own first page.
export function urlWithPage(url, page) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (page > 1) parsedUrl.searchParams.set("page", String(page));
  else parsedUrl.searchParams.delete("page");
  return parsedUrl.toString();
}

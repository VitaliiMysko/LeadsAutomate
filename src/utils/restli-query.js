// Sales Navigator keeps the whole search state in the `query` URL parameter,
// encoded in Rest.li protocol syntax, e.g.
//   (filters:List((type:CURRENT_TITLE,values:List((id:8,text:CTO,selectionType:INCLUDED)))))
// Reading filters from the URL is language-independent and immune to
// LinkedIn's hashed CSS class names, unlike scraping the filter panel.

const PEOPLE_SEARCH_URL_REGEX = /^https:\/\/www\.linkedin\.com\/sales\/search\/people/;

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

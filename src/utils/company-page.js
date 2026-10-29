// A company's LinkedIn page, for its numeric id and name when the companies
// file has only the page URL by name ("https://www.linkedin.com/company/acme/").

// The page path ("company/acme") of a LinkedIn company, showcase or school
// page URL; the name part decoded and lowercased (LinkedIn's are
// case-insensitive). Null for anything else.
export function companyPagePath(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(company|showcase|school)\/([^/?#\s]+)/i);
  if (!match) return null;
  let slug = match[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Kept as written when it isn't valid percent-encoding.
  }
  return `${match[1].toLowerCase()}/${slug.toLowerCase()}`;
}

// The page's address to fetch, from companyPagePath's path.
export function companyPageUrl(path) {
  const [kind, slug] = path.split("/");
  return `https://www.linkedin.com/${kind}/${encodeURIComponent(slug)}/`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

// The company's name on LinkedIn from a public company page: its og:title
// without the " | LinkedIn" suffix, e.g. "Moriyama - Umbraco Platinum
// Partner UK/US". Null if it isn't there.
export function companyNameFromPageHtml(html) {
  const match = String(html ?? "").match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (!match) return null;
  const name = decodeEntities(match[1])
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}

// The numeric id of the company a public (logged-out) LinkedIn company page
// is about, null if it isn't there. Read from the page's own top card and
// overview module only: the page also lists other companies (similar pages,
// affiliates) with their ids.
export function companyIdFromPageHtml(html) {
  const text = String(html ?? "");
  const match =
    text.match(/data-semaphore-content-urn="urn:li:organization:(\d+)"/) ||
    text.match(/"organization":\{"objectUrn":"urn:li:organization:(\d+)"\}/);
  return match ? match[1] : null;
}

// Read once more when it's inside a script's string ({\"key\":\"1\"}).
function parsePayload(object) {
  try {
    return JSON.parse(object.includes('\\"') ? JSON.parse(`"${object}"`) : object);
  } catch {
    return null;
  }
}

// The id and name of the organization a LinkedIn page seen signed in is
// about, null if they aren't there. The page has no og:title or top-card
// urn; they're read from the request its top card is loaded with, where the
// page's name part (or id) from companyPagePath's path sits next to them:
// {"organizationIdOrVanityName":"jmcacademy","organizationId":"481261",
// "organizationName":"JMC Academy"}. Other organizations on the page (similar
// pages, follow buttons) don't have the page's name part.
export function organizationFromSignedInPageHtml(html, path) {
  const slug = String(path ?? "").split("/")[1];
  if (!slug) return null;
  for (const [object] of String(html ?? "").matchAll(/\{[^{}]*organizationIdOrVanityName[^{}]*\}/g)) {
    const payload = parsePayload(object);
    if (String(payload?.organizationIdOrVanityName ?? "").toLowerCase() !== slug) continue;
    const id = String(payload.organizationId ?? "");
    if (!/^[1-9]\d*$/.test(id)) continue;
    const name = typeof payload.organizationName === "string" ? payload.organizationName.replace(/\s+/g, " ").trim() : "";
    return { id, name: name || null };
  }
  return null;
}

// Optional developer settings from local.settings.json in the extension's
// folder (git-ignored and never packaged; see local.settings.example.json).

// The Lead generator ids listed in the parsed local settings: the non-empty
// strings of `leadGeneratorIds`, trimmed; [] when there are none.
export function localLeadGeneratorIds(settings) {
  const ids = settings?.leadGeneratorIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
}

// `localIds` first (a local copy is what's being tested), then `knownIds`,
// without repeats.
export function withLocalIds(knownIds, localIds) {
  return [...new Set([...localIds, ...knownIds])];
}

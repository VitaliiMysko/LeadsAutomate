// The version shown in the panel's header: "(dev)" marks a copy loaded
// unpacked (Chrome) or as a temporary add-on (Firefox), whose install type
// (management.getSelf()) is "development".
export function versionLabel(version, installType) {
  return installType === "development" ? `v${version} (dev)` : `v${version}`;
}

// Chrome gives an extension a 32-letter id written with a–p; Firefox uses
// the add-on id from browser_specific_settings (e.g. name@domain).
const CHROME_ID_REGEX = /^[a-p]{32}$/;

// The ids from `ids` that the browser running this extension (whose own id
// is `ownId`) can give an extension, in their order.
export function idsForThisBrowser(ownId, ids) {
  const chrome = CHROME_ID_REGEX.test(ownId);
  return ids.filter((id) => CHROME_ID_REGEX.test(id) === chrome);
}

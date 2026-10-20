import { FILTER_TYPES, getFilterTexts } from "../../utils/restli-query.js";
import { isSameName } from "../../utils/text-utils.js";
import { getSearchTab, sendToContent, waitForTabUrl } from "./tab-service.js";

const COMPANY = FILTER_TYPES.CURRENT_COMPANY;

const companyTexts = (url) => getFilterTexts(url, COMPANY);

// Replaces the "Current company" filter with `name` and waits for the
// results to render. Each step is verified against the tab URL, where Sales
// Navigator records the applied filters.
// Returns { appliedText, count }; throws FatalError when the run can't go on.
export async function searchCompany(name, log) {
  const tab = await getSearchTab();
  await sendToContent(tab.id, "ping");

  const current = companyTexts(tab.url);
  const alreadyApplied = current.length === 1 && isSameName(current[0], name);

  if (alreadyApplied) {
    log.info(`"${current[0]}" is already the Current company filter`);
  } else {
    if (current.length) {
      log.info(`Removing current company filter: ${current.join(", ")}`);
      await sendToContent(tab.id, "clearFilterValues", { filterType: COMPANY, values: current });
      await waitForTabUrl(tab.id, (url) => companyTexts(url).length === 0, {
        description: "the previous company filter to be removed",
      });
    }

    log.info(`Typing "${name}" into Current company`);
    const { selectedText } = await sendToContent(tab.id, "addFilterValue", { filterType: COMPANY, text: name });
    log.debug(`Selected suggestion "${selectedText}"`);

    await waitForTabUrl(tab.id, (url) => companyTexts(url).length > 0, {
      description: "the company filter to be applied",
    });
  }

  const appliedUrl = (await chrome.tabs.get(tab.id)).url;
  const applied = companyTexts(appliedUrl);
  const appliedText = applied.join(", ");
  if (!applied.some((text) => isSameName(text, name))) {
    log.warn(`Applied company "${appliedText}" differs from "${name}"`);
  }

  log.debug("Waiting for search results");
  const { count, settled } = await sendToContent(tab.id, "waitForResults");
  if (!settled) log.warn("Results area kept changing; the count may be incomplete");

  return { appliedText, count };
}

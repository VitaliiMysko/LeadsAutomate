import { FILTER_TYPES, SELECTION_TYPES, getFilterTexts, getFilterValues, urlWithoutFilter } from "../../utils/restli-query.js";
import { chooseCompanyOption } from "../../utils/company-match.js";
import { applyLogoCheck, LOGO_VERDICTS } from "../../utils/logo-match.js";
import { logoDistance, logoSimilarity } from "../../utils/image-hash.js";
import { MATCH_KINDS } from "../../utils/match-records.js";
import { TIMING, LOGO_THRESHOLDS, LOGO_FIRST } from "../../constants/config.js";
import { formatDuration } from "../../utils/text-utils.js";
import { hashRemoteLogo } from "./logo-service.js";
import { getSearchTab, sendToContent, waitForTabUrl, FatalError, StoppedError, WaitTimeoutError } from "./tab-service.js";
import { recordMatch } from "./match-recorder.js";

const COMPANY = FILTER_TYPES.CURRENT_COMPANY;

const includedCompanies = (url) => getFilterTexts(url, COMPANY, SELECTION_TYPES.INCLUDED);
const allCompanies = (url) => [
  ...includedCompanies(url),
  ...getFilterTexts(url, COMPANY, SELECTION_TYPES.EXCLUDED),
];

async function saveRecord(kind, fields, log) {
  try {
    const total = await recordMatch(kind, fields);
    log.debug(`Saved ${kind} match record (${total} stored)`);
  } catch (error) {
    log.warn(`Could not save the ${kind} match record: ${error.message}`);
  }
}

// Ways to remove the previous company values, tried in order. In-page
// navigation (the URL without the filter + popstate) works without a page
// load; reloading that URL is the fallback. Script-generated clicks, Enter /
// Space on the remove button and Backspace in the input had no effect.
const REMOVE_STRATEGIES = ["in-page-navigation", "reload"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls the page until none of `values` shows as selected; returns the
// values still shown when time runs out (empty on success).
async function waitForValuesGone(tabId, values, timeout) {
  const deadline = Date.now() + timeout;
  let present = values;
  while (Date.now() < deadline) {
    ({ present } = await sendToContent(tabId, "presentFilterValues", { filterType: COMPANY, values }));
    if (!present.length) return [];
    await sleep(400);
  }
  return present;
}

// Detailed DEBUG picture of the selected values on the page, logged when
// removing them fails.
async function logFilterSnapshot(tabId, values, log, when) {
  let snapshot;
  try {
    snapshot = await sendToContent(tabId, "inspectFilterValues", { filterType: COMPANY, values });
  } catch (error) {
    log.warn(`Company filter snapshot (${when}) failed: ${error.message}`);
    return;
  }
  log.debug(`Company filter snapshot (${when}): ${snapshot.expanded ? "expanded" : "collapsed"}, fieldset ${snapshot.fieldset}`);
  for (const value of snapshot.values) {
    log.debug(`  "${value.text}": found on page=${value.found}`);
    log.debug(`    text element: ${value.textElement}`);
    log.debug(`    container: ${value.container}`);
    value.containerButtons.forEach((button, index) => log.debug(`    container button #${index + 1}: ${button}`));
    if (value.html) log.debug(`    HTML: ${value.html}`);
  }
}

const REMOVERS = {
  async "in-page-navigation"(tabId, url, values, log) {
    const target = urlWithoutFilter(url, COMPANY);
    if (!target) throw new Error("could not read the search filters from the page URL");
    await sendToContent(tabId, "navigateInPage", { url: target });

    const left = await waitForValuesGone(tabId, values, TIMING.selectAttemptTimeoutMs);
    const nowUrl = (await chrome.tabs.get(tabId)).url;
    if (!left.length && !allCompanies(nowUrl).length) return true;

    log.debug(`After in-page navigation: URL companies=[${allCompanies(nowUrl).join(", ")}], still on page=[${left.join(", ")}]`);
    await logFilterSnapshot(tabId, values, log, "in-page navigation ignored");
    // Put the URL back in line with what the page shows.
    const { restored } = await sendToContent(tabId, "undoInPageNavigation");
    log.debug(`Previous URL ${restored ? "restored" : "not restored"}`);
    return false;
  },

  async reload(tabId, url) {
    const target = urlWithoutFilter(url, COMPANY);
    if (!target) throw new Error("could not read the search filters from the page URL");
    await chrome.tabs.update(tabId, { url: target });
    await waitForTabUrl(tabId, (candidate) => allCompanies(candidate).length === 0, {
      description: "the reloaded search URL",
    });
    await waitForFilterReady(tabId);
    return true;
  },
};

async function removeCompanyValues(tabId, url, log) {
  const values = allCompanies(url);
  log.info(`Removing previous company: ${values.join(", ")}`);

  for (const strategy of REMOVE_STRATEGIES) {
    const startedAt = Date.now();
    if (strategy === "reload") log.warn("Removal without reload failed; reloading the search without the company");

    let removed = false;
    try {
      removed = await REMOVERS[strategy](tabId, url, values, log);
    } catch (error) {
      if (error instanceof FatalError) throw error;
      log.warn(`Removing by ${strategy} failed: ${error.message}`);
    }
    const took = formatDuration(Date.now() - startedAt);
    if (removed) {
      log.debug(`Previous company removed by ${strategy} (${took})`);
      await waitForFilterReady(tabId);
      return;
    }
    log.warn(`Removing by ${strategy} had no effect (${took})`);
    url = (await chrome.tabs.get(tabId)).url;
  }
  throw new Error(
    `Previous company filter values were not removed (tried: ${REMOVE_STRATEGIES.join(", ")}): ${allCompanies(url).join(", ")}`
  );
}

// Waits for a (re)loaded search page: loaded, page script answering and
// the company filter rendered.
async function waitForFilterReady(tabId) {
  const deadline = Date.now() + TIMING.pageReloadTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        const { ready } = await sendToContent(tabId, "isFilterReady", { filterType: COMPANY }, 5000);
        if (ready) return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`The search page didn't get ready${lastError ? ` (${lastError.message})` : ""}`);
}

// Selects the option (with the keyboard, see selectSuggestion in the content
// script) and returns the URL with it applied as an included company.
// Throws when it can't be selected, lands as excluded, or a different
// company or free text got applied (that one is removed again, so a wrong
// company never stays in the filter or in the match records).
async function selectOption(tabId, index, label, log) {
  let clicked;
  try {
    ({ clicked } = await sendToContent(tabId, "selectSuggestion", { filterType: COMPANY, index, label }));
  } catch (error) {
    if (error instanceof FatalError) throw error;
    throw new Error(`Could not select "${label}" in the dropdown: ${error.message}`);
  }

  let url;
  try {
    url = await waitForTabUrl(tabId, (candidate) => allCompanies(candidate).length > 0, {
      timeout: TIMING.selectAttemptTimeoutMs,
      description: `"${label}" to be applied`,
    });
  } catch (error) {
    if (!(error instanceof WaitTimeoutError)) throw error;
    throw new Error(`Selecting "${label}" had no effect (${clicked})`);
  }

  const applied = getFilterValues(url, COMPANY);
  if (!applied.length) {
    await removeCompanyValues(tabId, url, log);
    throw new Error(`"${label}" was added as an excluded company (${clicked}); removed it`);
  }
  const match = applied.find((value) => value.text === label);
  if (!match || !match.id) {
    const what = applied.map((value) => `"${value.text}"${value.id ? "" : " (free text, no company id)"}`).join(", ");
    log.error(`Wrong company applied: ${what} instead of "${label}" (${clicked}); removing it`);
    await removeCompanyValues(tabId, url, log);
    throw new Error(`${what} was applied instead of "${label}" and was removed`);
  }
  log.debug(`"${label}" applied (${clicked}; company id ${match.id})`);
  return url;
}

const LOGO_VERDICT_LOG = {
  [LOGO_VERDICTS.CONFIRMED]: ["success", "logo confirms the choice"],
  [LOGO_VERDICTS.UNSURE]: ["warn", "logo similarity is unclear; keeping the choice"],
  [LOGO_VERDICTS.DIFFERENT_KEPT]: ["warn", "logo differs, but the name matches exactly; keeping the choice"],
  [LOGO_VERDICTS.OVERRIDDEN]: ["warn", "logo picked a different option than the name"],
  [LOGO_VERDICTS.CHOSEN_BY_LOGO]: ["success", "chosen by logo"],
};

// Compares the companies file's logo with each dropdown option's logo and
// lets logo-match.js confirm, change or drop the name-based choice. Options
// without a logo (or whose image can't be read) don't take part.
async function checkLogos(choice, options, logos, fileLogo, log) {
  const urls = logos ?? [];
  if (!urls.some(Boolean)) {
    log.debug("Logo check skipped: no option in the dropdown shows a logo");
    return choice;
  }
  const hashes = await Promise.all(urls.map((url) => (url ? hashRemoteLogo(url) : null)));
  const distances = hashes.map((hash) => (hash ? logoDistance(fileLogo.hash, hash) : null));
  log.debug(
    "Logo similarity: " +
      options
        .map((label, i) => `#${i + 1} "${label}" ${distances[i] === null ? (urls[i] ? "unreadable" : "no logo") : `${logoSimilarity(distances[i])}% (distance ${distances[i]})`}`)
        .join(", ")
  );

  const checked = applyLogoCheck(choice, distances, LOGO_THRESHOLDS, { logoFirst: LOGO_FIRST });
  const verdict = checked.logo?.verdict;
  if (verdict) {
    const [level, text] = LOGO_VERDICT_LOG[verdict];
    log[level](`Logo check: ${text} (similarity ${logoSimilarity(checked.logo.distance)}%)`);
  } else if (checked.index === -1 && choice.index !== -1) {
    log.warn(`Logo check: ${checked.reason}`);
  }
  return checked;
}

async function waitForResults(tabId, log) {
  log.debug("Waiting for search results");
  const { count, settled } = await sendToContent(tabId, "waitForResults");
  if (!settled) log.warn("Results area kept changing; the count may be incomplete");
  return count;
}

// Replaces every "Current company" filter value with `name`, picks the
// company from the typeahead by the rules in company-match.js and waits for
// the results. Each step is verified against the tab URL, where Sales
// Navigator records the applied filters.
//
// When no option can be chosen automatically:
// - with `waitForManualChoice`, the dropdown stays open for the user, and
//   their pick (read from the URL) is recorded as a manual match;
// - otherwise the dropdown is closed and the company reported unresolved.
//
// `fileLogo` ({ hash }) is the company's logo from the companies CSV: when
// given, the choice is also checked against the dropdown's logos.
//
// Returns { outcome: "already" | "auto" | "manual" | "unresolved", chosen,
// rule, reason, logo, count }. Throws FatalError when a batch run can't go on.
export async function searchCompany(name, { log, fileLogo = null, waitForManualChoice = false, onManualWait, shouldStop }) {
  const tab = await getSearchTab();
  await sendToContent(tab.id, "ping");

  const current = allCompanies(tab.url);
  if (current.length === 1 && includedCompanies(tab.url)[0] === name) {
    log.info(`"${name}" is already the only Current company filter value`);
    return { outcome: "already", chosen: name, count: await waitForResults(tab.id, log) };
  }

  if (current.length) {
    await removeCompanyValues(tab.id, tab.url, log);
  }

  log.info(`Typing "${name}" into Current company`);
  const { options, logos } = await sendToContent(tab.id, "typeFilterValue", { filterType: COMPANY, text: name });
  log.debug(options.length ? `Dropdown (${options.length}): ${options.join(" | ")}` : "Dropdown is empty");

  let choice = chooseCompanyOption(name, options);
  if (fileLogo?.hash && options.length) choice = await checkLogos(choice, options, logos, fileLogo, log);

  if (choice.index !== -1) {
    const label = options[choice.index];
    log.info(`Auto-choosing "${label}" (option ${choice.index + 1} of ${options.length}) for "${name}": ${choice.description}`);
    await selectOption(tab.id, choice.index, label, log);
    log.success(`Auto-selected "${label}" for "${name}": ${choice.description}`);

    await saveRecord(MATCH_KINDS.AUTO, { typed: name, chosen: label, rule: choice.rule, options, logo: choice.logo }, log);
    return {
      outcome: "auto",
      chosen: label,
      rule: choice.rule,
      logo: { url: logos[choice.index] ?? null, ...choice.logo },
      count: await waitForResults(tab.id, log),
    };
  }

  log.warn(`No automatic choice for "${name}": ${choice.reason}`);
  const unresolved = async (reason) => {
    await sendToContent(tab.id, "dismissSuggestions", { filterType: COMPANY }).catch(() => {});
    return { outcome: "unresolved", reason };
  };

  if (!waitForManualChoice) return unresolved(choice.reason);

  const timeout = TIMING.manualChoiceTimeoutMs;
  log.info(`Pick the company in the Sales Navigator dropdown (waiting up to ${formatDuration(timeout)}; Stop cancels)`);
  onManualWait?.();

  let url;
  try {
    url = await waitForTabUrl(tab.id, (candidate) => includedCompanies(candidate).length > 0, {
      timeout,
      description: "a company to be picked by hand",
      shouldStop,
    });
  } catch (error) {
    if (error instanceof FatalError) throw error;
    if (error instanceof StoppedError) return unresolved("manual choice cancelled");
    if (error instanceof WaitTimeoutError) return unresolved(`no manual choice within ${formatDuration(timeout)}`);
    throw error;
  }

  const chosen = includedCompanies(url).join(", ");
  log.success(`Manually selected "${chosen}" for "${name}"`);
  await saveRecord(MATCH_KINDS.MANUAL, { typed: name, chosen, reason: choice.reason, options }, log);
  return { outcome: "manual", chosen, count: await waitForResults(tab.id, log) };
}

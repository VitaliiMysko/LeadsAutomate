import {
  FILTER_TYPES,
  SELECTION_TYPES,
  getFilterTexts,
  getFilterValues,
  urlWithoutFilter,
  urlWithCompany,
} from "../../utils/restli-query.js";
import { chooseCompanyOption, resemblesName, hasSameName, MATCH_RULES } from "../../utils/company-match.js";
import { shorterNameVariants } from "../../utils/name-variants.js";
import { applyLogoCheck, LOGO_VERDICTS } from "../../utils/logo-match.js";
import { logoDistance, logoSimilarity } from "../../utils/image-hash.js";
import { MATCH_KINDS, MATCH_MODES, companyIdFromUrn } from "../../utils/match-records.js";
import { nameFeatures } from "../../utils/name-features.js";
import { TIMING, LOGO_THRESHOLDS, SHORTER_NAME_ATTEMPTS } from "../../constants/config.js";
import { formatDuration, randomBetween } from "../../utils/text-utils.js";
import { hashRemoteLogo } from "./logo-service.js";
import { getSearchTab, sendToContent, waitForTabUrl, FatalError, StoppedError, WaitTimeoutError } from "./tab-service.js";
import { recordMatch } from "./match-recorder.js";

const COMPANY = FILTER_TYPES.CURRENT_COMPANY;

const includedCompanies = (url) => getFilterTexts(url, COMPANY, SELECTION_TYPES.INCLUDED);
const allCompanies = (url) => [
  ...includedCompanies(url),
  ...getFilterTexts(url, COMPANY, SELECTION_TYPES.EXCLUDED),
];
// The company filter in `url` is just the company with id `companyId`, included.
const isOnlyCompany = (url, companyId) => {
  const values = getFilterValues(url, COMPANY);
  return allCompanies(url).length === 1 && values.length === 1 && companyIdFromUrn(values[0].id) === companyId;
};

async function saveRecord(kind, fields, log) {
  try {
    const total = await recordMatch(kind, fields);
    log.debug(`Saved ${kind} match record, company id ${fields.companyId ?? "unknown"} (${total} stored)`);
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

// Ways to set the company by its id, tried in order, like REMOVE_STRATEGIES:
// the search URL with the company in it, followed in the page, else loaded.
const APPLY_BY_ID_STRATEGIES = ["in-page-navigation", "reload"];

// Polls until the tab URL holds just the company `companyId` and the page
// shows it as the only selected value; returns that URL, or null when time
// runs out. The URL alone isn't enough after in-page navigation: it's the
// one the extension wrote, followed by the page or not.
//
// The page shows LinkedIn's name for the company ("American Vacuum Society
// (AVS)"), not the file's label in the URL ("AVS"), so it counts as shown
// when the page has one selected value that wasn't there before the change
// (`shownBefore`, the page's values then). Failing that, the label itself
// shown as selected with none of `previous` (the URL's earlier labels) left.
async function waitForCompanyShown(tabId, companyId, previous, shownBefore, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const url = (await chrome.tabs.get(tabId)).url;
    if (isOnlyCompany(url, companyId)) {
      const { texts } = await sendToContent(tabId, "selectedFilterTexts", { filterType: COMPANY });
      if (texts.length === 1 && !shownBefore.includes(texts[0])) return url;
      const [{ text }] = getFilterValues(url, COMPANY);
      const others = previous.filter((value) => value !== text);
      const { present } = await sendToContent(tabId, "presentFilterValues", { filterType: COMPANY, values: [text, ...others] });
      if (present.length === 1 && present[0] === text) return url;
    }
    await sleep(400);
  }
  return null;
}

const APPLIERS_BY_ID = {
  async "in-page-navigation"(tabId, target, companyId, previous, log) {
    const { texts: shownBefore } = await sendToContent(tabId, "selectedFilterTexts", { filterType: COMPANY });
    await sendToContent(tabId, "navigateInPage", { url: target });
    const url = await waitForCompanyShown(tabId, companyId, previous, shownBefore, TIMING.selectAttemptTimeoutMs);
    if (url) return url;

    const nowUrl = (await chrome.tabs.get(tabId)).url;
    const { texts: shownNow } = await sendToContent(tabId, "selectedFilterTexts", { filterType: COMPANY });
    log.debug(
      `After in-page navigation: URL companies=[${allCompanies(nowUrl).join(", ")}], ` +
        `page shows [${shownNow.join(", ")}], before [${shownBefore.join(", ")}]`
    );
    await logFilterSnapshot(tabId, [...new Set([...allCompanies(nowUrl), ...previous])], log, "company by id not shown");
    const { restored } = await sendToContent(tabId, "undoInPageNavigation");
    log.debug(`Previous URL ${restored ? "restored" : "not restored"}`);
    return null;
  },

  // After a page load the URL is what Sales Navigator made of it, so it
  // decides; a value the page doesn't show under the given label is only
  // reported.
  async reload(tabId, target, companyId, previous, log) {
    await chrome.tabs.update(tabId, { url: target });
    await waitForTabUrl(tabId, (candidate) => isOnlyCompany(candidate, companyId), {
      description: "the search URL with the company id",
    });
    await waitForFilterReady(tabId);
    const url = (await chrome.tabs.get(tabId)).url;
    if (!isOnlyCompany(url, companyId)) {
      throw new Error(`the loaded search has companies [${allCompanies(url).join(", ")}] instead of id ${companyId}`);
    }
    // A loaded page shows only what its URL holds: any one value is the company.
    if (!(await waitForCompanyShown(tabId, companyId, previous, [], TIMING.selectAttemptTimeoutMs))) {
      log.warn(`The URL has company id ${companyId}, but the page doesn't show "${getFilterValues(url, COMPANY)[0].text}" as selected`);
    }
    return url;
  },
};

// Replaces every "Current company" value with the company whose LinkedIn id
// is `companyId`, labelled `text`, without the typeahead; returns the
// applied URL. Throws when no strategy worked.
async function applyCompanyById(tabId, companyId, text, log) {
  let url = (await chrome.tabs.get(tabId)).url;
  log.info(`Setting Current company to id ${companyId} ("${text}")`);
  await sleep(randomBetween(...TIMING.beforeCompanyByIdMs));

  for (const strategy of APPLY_BY_ID_STRATEGIES) {
    const target = urlWithCompany(url, companyId, text);
    if (!target) throw new Error("could not read the search filters from the page URL");
    const previous = allCompanies(url);
    const startedAt = Date.now();
    if (strategy === "reload") log.warn("Setting the company without reload failed; loading the search with it");

    let applied = null;
    try {
      applied = await APPLIERS_BY_ID[strategy](tabId, target, companyId, previous, log);
    } catch (error) {
      if (error instanceof FatalError) throw error;
      log.warn(`Setting the company by ${strategy} failed: ${error.message}`);
    }
    const took = formatDuration(Date.now() - startedAt);
    if (applied) {
      log.debug(`Company id ${companyId} applied by ${strategy} (${took})`);
      return applied;
    }
    log.warn(`Setting the company by ${strategy} had no effect (${took})`);
    url = (await chrome.tabs.get(tabId)).url;
  }
  throw new Error(`company id ${companyId} was not applied (tried: ${APPLY_BY_ID_STRATEGIES.join(", ")})`);
}

// Sets the company by its id from the companies file. Returns the search
// result, or null when it couldn't be set (the caller then searches by name).
async function searchById(tab, name, companyId, log) {
  if (isOnlyCompany(tab.url, companyId)) {
    log.info(`Company id ${companyId} ("${name}") is already the only Current company filter value`);
    return { outcome: "already", chosen: name, companyId, count: await waitForResults(tab.id, log) };
  }
  try {
    await applyCompanyById(tab.id, companyId, name, log);
  } catch (error) {
    if (error instanceof FatalError) throw error;
    log.warn(`Could not set "${name}" by company id: ${error.message}. Searching by name instead`);
    return null;
  }
  log.success(`Selected "${name}" by company id ${companyId}`);
  const count = await waitForResults(tab.id, log);
  if (count === 0) log.warn(`No leads for company id ${companyId}: check that it's the right id for "${name}" in the file`);
  return { outcome: "by-id", chosen: name, companyId, count };
}

// Warns when the company chosen in the dropdown isn't the one the companies
// file names by id.
function checkFileCompanyId(fileCompanyId, chosenId, chosen, log) {
  if (!fileCompanyId || !chosenId) return;
  if (chosenId === fileCompanyId) log.success(`"${chosen}" has the file's company id ${fileCompanyId}`);
  else log.warn(`"${chosen}" has company id ${chosenId}, the file gives ${fileCompanyId}`);
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
  [LOGO_VERDICTS.NOT_CONFIRMED]: ["info", "logo doesn't confirm the choice (LinkedIn logos often differ from the file's); keeping it"],
  [LOGO_VERDICTS.CHOSEN_BY_LOGO]: ["success", "chosen by logo"],
};

// Logo distance of each dropdown option to the companies file's logo (null
// for an option without a readable logo), or null when there's nothing to
// compare.
async function logoDistances(options, logos, fileLogo, log) {
  if (!fileLogo?.hash || !options.length) return null;
  const urls = logos ?? [];
  if (!urls.some(Boolean)) {
    log.debug("Logo check skipped: no option in the dropdown shows a logo");
    return null;
  }
  const hashes = await Promise.all(urls.map((url) => (url ? hashRemoteLogo(url) : null)));
  const distances = hashes.map((hash) => (hash ? logoDistance(fileLogo.hash, hash) : null));
  log.debug(
    "Logo similarity: " +
      options
        .map((label, i) => `#${i + 1} "${label}" ${distances[i] === null ? (urls[i] ? "unreadable" : "no logo") : `${logoSimilarity(distances[i])}% (distance ${distances[i]})`}`)
        .join(", ")
  );
  return distances;
}

// Lets logo-match.js confirm the name-based choice, or choose by logo when
// the name rules couldn't.
function checkLogos(nameChoice, distances, eligible, log) {
  const checked = applyLogoCheck(nameChoice, distances, LOGO_THRESHOLDS, eligible);
  const verdict = checked.logo?.verdict;
  if (verdict) {
    const [level, text] = LOGO_VERDICT_LOG[verdict];
    log[level](`Logo check: ${text} (similarity ${logoSimilarity(checked.logo.distance)}%)`);
  }
  return checked;
}

// Per-option data for the match records.
function describeOptions(typed, options, details, logos, distances) {
  return options.map((label, index) => {
    const distance = distances?.[index] ?? null;
    return {
      index,
      label,
      text: details?.[index]?.text ?? label,
      logo: details?.[index]?.logo ?? (logos?.[index] ? "logo" : "none"),
      logoDistance: distance,
      logoSimilarity: distance === null ? null : logoSimilarity(distance),
      highlighted: details?.[index]?.highlighted ?? false,
      name: nameFeatures(typed, label),
    };
  });
}

// What the rules chose (or, in labeling mode, would have chosen).
function describePrediction(choice, nameChoice, options) {
  return {
    index: choice.index,
    label: options[choice.index] ?? null,
    rule: choice.rule ?? null,
    reason: choice.reason ?? null,
    nameIndex: nameChoice.index,
    nameRule: nameChoice.rule ?? null,
    logo: choice.logo ?? null,
  };
}

function predictionText(prediction) {
  return prediction.index === -1
    ? `nothing (${prediction.reason})`
    : `#${prediction.index + 1} "${prediction.label}" (${prediction.rule})`;
}

// Types `typed` into Current company and applies the rules to the dropdown.
// For a `shorter` name (one the file didn't give) only the same-name and
// logo rules choose: a short name finds more unrelated companies, so the
// only option in the list isn't taken on its own.
async function typeAndChoose(tabId, typed, fileLogo, log, { shorter = false } = {}) {
  log.info(`Typing "${typed}" into Current company`);
  const { options, logos, details } = await sendToContent(tabId, "typeFilterValue", { filterType: COMPANY, text: typed });
  log.debug(options.length ? `Dropdown (${options.length}): ${options.join(" | ")}` : "Dropdown is empty");

  let nameChoice = chooseCompanyOption(typed, options);
  if (shorter && nameChoice.rule === MATCH_RULES.SINGLE_OPTION) {
    nameChoice = { index: -1, reason: `the only option doesn't have the name "${typed}"` };
  }
  const distances = await logoDistances(options, logos, fileLogo, log);
  const eligible = options.map((option) => resemblesName(typed, option));
  const choice = distances ? checkLogos(nameChoice, distances, eligible, log) : nameChoice;
  return { typed, options, logos, details, distances, nameChoice, choice };
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
// When no option has the name and none is chosen by logo, up to
// SHORTER_NAME_ATTEMPTS shorter names (name-variants.js) are typed in turn,
// with a pause before each; the rules then apply to the last dropdown.
//
// When no option can be chosen automatically:
// - with `waitForManualChoice`, the dropdown stays open for the user, and
//   their pick (read from the URL) is recorded as a manual match;
// - otherwise the dropdown is closed and the company reported unresolved.
//
// `labeling`: the rules' choice is only predicted and logged, never applied;
// the user always picks, and the record keeps both for analysis.
//
// `fileLogo` ({ hash }) is the company's logo from the companies CSV: when
// given, the choice is also checked against the dropdown's logos. `csv`
// ({ companyId, linkedin, hasLogo }) goes into the match record.
//
// `companyId` is the company's LinkedIn id from the companies CSV: the
// company is then set by it (searchById), with no typeahead, rules or
// logos and no match record, and only when that fails is it searched by
// name. In labeling mode the name search always runs; the id then only
// checks the pick.
//
// Returns { outcome: "already" | "by-id" | "auto" | "manual" | "unresolved",
// chosen, companyId, typed, rule, reason, logo, count }. Throws FatalError
// when a batch run can't go on.
export async function searchCompany(
  name,
  { log, companyId = null, fileLogo = null, csv = null, labeling = false, waitForManualChoice = false, onManualWait, shouldStop }
) {
  let tab = await getSearchTab();
  await sendToContent(tab.id, "ping");

  if (companyId && !labeling) {
    const result = await searchById(tab, name, companyId, log);
    if (result) return result;
    tab = await getSearchTab();
  }

  const current = allCompanies(tab.url);
  if (!labeling && current.length === 1 && includedCompanies(tab.url)[0] === name) {
    log.info(`"${name}" is already the only Current company filter value`);
    return { outcome: "already", chosen: name, count: await waitForResults(tab.id, log) };
  }

  if (current.length) {
    await removeCompanyValues(tab.id, tab.url, log);
  }

  let attempt = await typeAndChoose(tab.id, name, fileLogo, log);
  const attempts = [];
  for (const variant of shorterNameVariants(name).slice(0, SHORTER_NAME_ATTEMPTS)) {
    if (attempt.choice.index !== -1 || attempt.options.some((option) => hasSameName(attempt.typed, option))) break;
    if (shouldStop?.()) break;
    attempts.push({ typed: attempt.typed, options: attempt.options.length, reason: attempt.choice.reason });
    log.info(`No option has the name "${attempt.typed}"; trying the shorter "${variant}"`);
    await sendToContent(tab.id, "dismissSuggestions", { filterType: COMPANY }).catch(() => {});
    await sleep(randomBetween(...TIMING.betweenRetypesMs));
    attempt = await typeAndChoose(tab.id, variant, fileLogo, log, { shorter: true });
  }
  const { typed, options, logos, details, distances, nameChoice } = attempt;
  let { choice } = attempt;
  const typedNote = typed === name ? "" : ` (typed "${typed}")`;
  if (choice.index === -1 && attempts.length) {
    const tried = [...attempts.map((previous) => previous.typed), typed].map((text) => `"${text}"`).join(", ");
    choice = { ...choice, reason: `${choice.reason}; tried ${tried}` };
  }

  const recordBase = {
    name,
    typed,
    attempts,
    csv,
    prediction: describePrediction(choice, nameChoice, options),
    options: describeOptions(typed, options, details, logos, distances),
  };
  const logoOf = (index) => ({
    url: logos?.[index] ?? null,
    ...(distances?.[index] !== null && distances?.[index] !== undefined ? { distance: distances[index] } : {}),
  });

  if (!labeling && choice.index !== -1) {
    const label = options[choice.index];
    log.info(`Auto-choosing "${label}" (option ${choice.index + 1} of ${options.length}) for "${name}"${typedNote}: ${choice.description}`);
    const url = await selectOption(tab.id, choice.index, label, log);
    log.success(`Auto-selected "${label}" for "${name}"${typedNote}: ${choice.description}`);

    const chosenId = companyIdFromUrn(getFilterValues(url, COMPANY).find((value) => value.text === label)?.id);
    checkFileCompanyId(companyId, chosenId, label, log);
    const count = await waitForResults(tab.id, log);
    await saveRecord(MATCH_KINDS.AUTO, { ...recordBase, mode: MATCH_MODES.AUTO, chosen: label, companyId: chosenId, leads: count }, log);
    return {
      outcome: "auto",
      chosen: label,
      companyId: chosenId,
      typed,
      rule: choice.rule,
      logo: { ...logoOf(choice.index), ...choice.logo },
      count,
    };
  }

  if (labeling) {
    log.info(`Labeling: the rules would choose ${predictionText(recordBase.prediction)}`);
  } else {
    log.warn(`No automatic choice for "${name}": ${choice.reason}`);
  }
  const unresolved = async (reason) => {
    await sendToContent(tab.id, "dismissSuggestions", { filterType: COMPANY }).catch(() => {});
    return { outcome: "unresolved", reason };
  };

  if (!labeling && !waitForManualChoice) return unresolved(choice.reason);

  const timeout = TIMING.manualChoiceTimeoutMs;
  log.info(`Pick the company in the Sales Navigator dropdown (waiting up to ${formatDuration(timeout)}; Stop cancels)`);
  onManualWait?.();
  const waitStartedAt = Date.now();

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
  const pickMs = Date.now() - waitStartedAt;

  const picked = getFilterValues(url, COMPANY);
  const chosen = picked.map((value) => value.text).join(", ");
  const pickedId = picked.map((value) => companyIdFromUrn(value.id)).filter(Boolean).join(", ") || null;
  const chosenIndex = options.indexOf(chosen);
  log.success(`Manually selected "${chosen}" for "${name}"${typedNote}`);
  checkFileCompanyId(companyId, pickedId, chosen, log);
  if (labeling) {
    const agreed = recordBase.prediction.index === chosenIndex;
    log[agreed ? "success" : "warn"](
      `Labeling: you picked ${chosenIndex === -1 ? "a company not in the dropdown" : `#${chosenIndex + 1}`}; ` +
        `the rules ${agreed ? "agree" : `would have chosen ${predictionText(recordBase.prediction)}`}`
    );
  }

  const count = await waitForResults(tab.id, log);
  await saveRecord(
    MATCH_KINDS.MANUAL,
    {
      ...recordBase,
      mode: labeling ? MATCH_MODES.LABELING : MATCH_MODES.FALLBACK,
      chosen,
      companyId: pickedId,
      leads: count,
      pickMs,
    },
    log
  );
  const pickedLogo = chosenIndex === -1 ? {} : logoOf(chosenIndex);
  return { outcome: "manual", chosen, companyId: pickedId, typed, logo: { ...pickedLogo, verdict: "picked by hand" }, count };
}

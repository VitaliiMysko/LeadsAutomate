import { LEAD_GENERATOR, TIMING } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { FatalError } from "./tab-service.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the Lead generator extension's Extract, Generate and Save for the lead
// opened on the search tab, through its companion API (messages to its panel
// on that tab, which it's asked to open when it isn't). Lead generator answers only this
// extension's id, fixed by the manifest key.

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function request(extensionId, action, tabId, timeout) {
  const response = await withTimeout(
    chrome.runtime.sendMessage(extensionId, { action, tabId }),
    timeout,
    `Lead generator didn't answer "${action}" within ${timeout / 1000}s`
  );
  if (!response?.ok) throw new Error(response?.error || `no answer to "${action}"`);
  return response.result;
}

// Installed, enabled copies of Lead generator, the published (Web Store) one
// first and unpacked development ones last.
async function installedIds() {
  const extensions = await chrome.management.getAll();
  return extensions
    .filter((extension) => extension.enabled && extension.type === "extension" && extension.name === LEAD_GENERATOR.name)
    .sort((a, b) => (a.installType === "development") - (b.installType === "development"))
    .map((extension) => extension.id);
}

// The version of the Lead generator `id` whose panel answers on `tabId`, or
// null.
async function ping(id, tabId, log) {
  try {
    const { version } = await request(id, "ping", tabId, LEAD_GENERATOR.pingTimeoutMs);
    return version;
  } catch (error) {
    log.debug(`${LEAD_GENERATOR.name} ${id}: ${error.message}`);
    return null;
  }
}

// Asks the Lead generator `id` to open its panel on `tabId`, as a click on
// its icon does, then waits for the panel to answer. Returns its version, or
// null when it can't open the panel there (also a version without openPanel).
async function openPanel(id, tabId, log) {
  await sleep(randomBetween(...LEAD_GENERATOR.beforeOpenPanelMs));
  try {
    const { shown } = await request(id, "openPanel", tabId, LEAD_GENERATOR.pingTimeoutMs);
    if (!shown) throw new Error("its icon isn't shown on this page");
  } catch (error) {
    log.debug(`${LEAD_GENERATOR.name} ${id} can't open its panel: ${error.message}`);
    return null;
  }
  log.info(`Opened the ${LEAD_GENERATOR.name} panel on this tab`);

  const deadline = Date.now() + LEAD_GENERATOR.panelOpenTimeoutMs;
  for (;;) {
    try {
      const { version } = await request(id, "ping", tabId, LEAD_GENERATOR.pingTimeoutMs);
      return version;
    } catch (error) {
      if (Date.now() >= deadline) {
        log.debug(`${LEAD_GENERATOR.name} ${id}'s opened panel: ${error.message}`);
        return null;
      }
    }
    await sleep(LEAD_GENERATOR.panelPollMs);
  }
}

function client(id, tabId) {
  const step = (action) => request(id, action, tabId, TIMING.leadGeneratorStepTimeoutMs);
  return {
    extract: () => step("extract"),
    generateEmails: () => step("generateEmails"),
    save: () => step("save"),
  };
}

// Finds the Lead generator whose panel answers on `tabId`, opening its panel
// there when none is open; returns a client with its steps. Throws
// FatalError when it isn't installed or its panel can't be opened there.
export async function connectLeadGenerator(tabId, log) {
  const ids = await installedIds();
  if (!ids.length) throw new FatalError(`${LEAD_GENERATOR.name} isn't installed or is disabled`);

  for (const id of ids) {
    const version = await ping(id, tabId, log);
    if (version) {
      log.debug(`${LEAD_GENERATOR.name} ${version} (${id}) answers on this tab`);
      return client(id, tabId);
    }
  }
  for (const id of ids) {
    const version = await openPanel(id, tabId, log);
    if (version) {
      log.debug(`${LEAD_GENERATOR.name} ${version} (${id}) answers on this tab`);
      return client(id, tabId);
    }
  }
  throw new FatalError(
    `${LEAD_GENERATOR.name}'s panel couldn't be opened: update ${LEAD_GENERATOR.name}, or open its panel on the Sales Navigator tab (its icon on the page), then search again`
  );
}

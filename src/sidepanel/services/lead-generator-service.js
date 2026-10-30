import { LEAD_GENERATOR, TIMING } from "../../constants/config.js";
import { FatalError } from "./tab-service.js";

// Runs the Lead generator extension's Extract, Generate and Save for the lead
// opened on the search tab, through its companion API (messages to its panel,
// which must be open on that tab). Lead generator answers only this
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

// Installed, enabled copies of Lead generator, development ones first.
async function installedIds() {
  const extensions = await chrome.management.getAll();
  return extensions
    .filter((extension) => extension.enabled && extension.type === "extension" && extension.name === LEAD_GENERATOR.name)
    .sort((a, b) => (b.installType === "development") - (a.installType === "development"))
    .map((extension) => extension.id);
}

// Finds the Lead generator whose panel answers on `tabId`; returns a client
// with its steps. Throws FatalError when it isn't installed or its panel
// isn't open there.
export async function connectLeadGenerator(tabId, log) {
  const ids = await installedIds();
  if (!ids.length) throw new FatalError(`${LEAD_GENERATOR.name} isn't installed or is disabled`);

  for (const id of ids) {
    try {
      const { version } = await request(id, "ping", tabId, LEAD_GENERATOR.pingTimeoutMs);
      log.debug(`${LEAD_GENERATOR.name} ${version} (${id}) answers on this tab`);
      const step = (action) => request(id, action, tabId, TIMING.leadGeneratorStepTimeoutMs);
      return {
        extract: () => step("extract"),
        generateEmails: () => step("generateEmails"),
        save: () => step("save"),
      };
    } catch (error) {
      log.debug(`${LEAD_GENERATOR.name} ${id}: ${error.message}`);
    }
  }
  throw new FatalError(
    `${LEAD_GENERATOR.name}'s panel doesn't answer: open it on the Sales Navigator tab (its icon on the page), then search again`
  );
}

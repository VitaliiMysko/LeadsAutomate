import { isPeopleSearchUrl } from "../../utils/restli-query.js";
import { TIMING } from "../../constants/config.js";

// An error after which a batch run can't continue (wrong page, page script
// missing...), as opposed to one company's search failing.
export class FatalError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The active tab of the window this side panel belongs to.
export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export async function getSearchTab() {
  const tab = await getActiveTab();
  if (!tab || !isPeopleSearchUrl(tab.url)) {
    throw new FatalError("Open a Sales Navigator people search (linkedin.com/sales/search/people) in the active tab");
  }
  return tab;
}

export async function sendToContent(tabId, action, payload = {}, timeout = TIMING.contentStepTimeoutMs) {
  let response;
  try {
    response = await withTimeout(
      chrome.tabs.sendMessage(tabId, { target: "la:content", action, ...payload }),
      timeout,
      `Page step "${action}" timed out after ${timeout / 1000}s`
    );
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(error?.message)) {
      throw new FatalError("The extension's page script isn't loaded: reload the Sales Navigator tab");
    }
    throw error;
  }
  if (!response) throw new Error(`No response to page step "${action}"`);
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

// Polls the tab's URL until `predicate(url)` holds; returns that URL.
export async function waitForTabUrl(tabId, predicate, { timeout = TIMING.urlChangeTimeoutMs, description }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new FatalError("The Sales Navigator tab was closed");
    }
    if (tab.url && predicate(tab.url)) return tab.url;
    await sleep(400);
  }
  throw new Error(`Timed out after ${timeout / 1000}s waiting for ${description}`);
}

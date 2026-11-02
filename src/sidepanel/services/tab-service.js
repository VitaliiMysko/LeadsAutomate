import { isPeopleSearchUrl } from "../../utils/restli-query.js";
import { isRateLimitResponse } from "../../utils/rate-limit.js";
import { TIMING } from "../../constants/config.js";

// An error after which a batch run can't continue (wrong page, page script
// missing...), as opposed to one company's search failing.
export class FatalError extends Error {}

// LinkedIn refused Sales Navigator's requests: the daily limit is used up.
export class RateLimitError extends FatalError {}

// The first Sales Navigator request LinkedIn refused with 429 (Too Many
// Requests) since clearRateLimit, seen in any tab: { url, at }, or null.
let rateLimited = null;

chrome.webRequest?.onCompleted.addListener(
  (details) => {
    if (!rateLimited && isRateLimitResponse(details)) rateLimited = { url: details.url, at: Date.now() };
  },
  { urls: ["https://www.linkedin.com/sales/*", "https://www.linkedin.com/sales-api/*"] }
);

// Forgets an earlier refusal; called when the user starts a search, so a
// new search tries again (and stops at once if the limit still holds).
export function clearRateLimit() {
  rateLimited = null;
}

// Throws RateLimitError once LinkedIn has refused a request for too many
// requests, so the run stops at its next page step.
export function checkRateLimit() {
  if (!rateLimited) return;
  const at = new Date(rateLimited.at).toLocaleTimeString();
  throw new RateLimitError(
    `LinkedIn answered "Too many requests" at ${at}: the daily Sales Navigator limit is used up. ` +
      "Searching stopped; continue when the limit resets (usually the next day)"
  );
}

export class WaitTimeoutError extends Error {}

// A wait ended by the user (Stop).
export class StoppedError extends Error {}

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

// Checks for LinkedIn's rate limit before and after the step: a step that
// loaded data may have been refused.
export async function sendToContent(tabId, action, payload = {}, timeout = TIMING.contentStepTimeoutMs) {
  checkRateLimit();
  try {
    return await sendStep(tabId, action, payload, timeout);
  } finally {
    checkRateLimit();
  }
}

async function sendStep(tabId, action, payload, timeout) {
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
// `shouldStop` lets the user cancel a long wait.
export async function waitForTabUrl(
  tabId,
  predicate,
  { timeout = TIMING.urlChangeTimeoutMs, description, shouldStop = () => false }
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (shouldStop()) throw new StoppedError(`Stopped while waiting for ${description}`);
    checkRateLimit();
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new FatalError("The Sales Navigator tab was closed");
    }
    if (tab.url && predicate(tab.url)) return tab.url;
    await sleep(400);
  }
  throw new WaitTimeoutError(`Timed out after ${timeout / 1000}s waiting for ${description}`);
}

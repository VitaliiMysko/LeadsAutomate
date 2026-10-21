window.leadsAutomate = window.leadsAutomate || {};

(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Randomized pause between UI actions, so the page sees human-like pacing.
  function humanDelay(min = 350, max = 900) {
    return sleep(min + Math.random() * (max - min));
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function queryFirst(root, selectors, { visibleOnly = false } = {}) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (!visibleOnly || isVisible(element)) return element;
      }
    }
    return null;
  }

  // All matches of the first selector that matches anything.
  function queryAllFirst(root, selectors, { visibleOnly = false } = {}) {
    for (const selector of selectors) {
      const elements = [...root.querySelectorAll(selector)].filter(
        (element) => !visibleOnly || isVisible(element)
      );
      if (elements.length) return elements;
    }
    return [];
  }

  async function waitFor(check, { timeout = 8000, interval = 150, description = "element" } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(interval);
    }
    throw new Error(`Timed out after ${timeout}ms waiting for ${description}`);
  }

  // Resolves once `root` has had no DOM mutations for `quietMs`, or after
  // `timeout` regardless (LinkedIn pages rarely go fully quiet).
  function waitForDomQuiet(root, { quietMs = 1500, timeout = 20000 } = {}) {
    return new Promise((resolve) => {
      let quietTimer = null;
      const finish = (settled) => {
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        resolve(settled);
      };
      const restartQuietTimer = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(true), quietMs);
      };
      const observer = new MutationObserver(restartQuietTimer);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      const hardTimer = setTimeout(() => finish(false), timeout);
      restartQuietTimer();
    });
  }

  // Sets an input's value through the native setter, so framework-managed
  // inputs register the change, then fires the events they listen to.
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function typeText(input, text) {
    input.focus();
    setInputValue(input, "");
    let typed = "";
    for (const char of text) {
      typed += char;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
      setInputValue(input, typed);
      input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
      await sleep(60 + Math.random() * 110);
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const KEYS = {
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    Enter: { code: "Enter", keyCode: 13 },
    Escape: { code: "Escape", keyCode: 27 },
  };

  function pressKey(element, key) {
    const { code, keyCode } = KEYS[key];
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
    element.dispatchEvent(new KeyboardEvent("keydown", init));
    element.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // Everything that tells how an element can be interacted with, for
  // diagnosing why a script action had no effect.
  function describeElementDetailed(element) {
    if (!element) return "(none)";
    const attributes = ["id", "role", "type", "aria-label", "aria-pressed", "aria-expanded", "tabindex", "disabled"]
      .filter((name) => element.hasAttribute(name))
      .map((name) => `${name}="${element.getAttribute(name)}"`);
    const dataAttributes = [...element.attributes]
      .filter(({ name }) => name.startsWith("data-"))
      .map(({ name, value }) => `${name}="${value.slice(0, 30)}"`);
    const classes = [...element.classList].slice(0, 4).join(".");
    const rect = element.getBoundingClientRect();
    return (
      `<${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""} ${[...attributes, ...dataAttributes].join(" ")}>` +
      ` visible=${isVisible(element)} size=${Math.round(rect.width)}x${Math.round(rect.height)}` +
      ` text="${(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)}"`
    );
  }

  function truncatedHtml(element, limit = 1200) {
    if (!element) return "";
    const html = element.outerHTML.replace(/\s+/g, " ").replace(/<!---->/g, "");
    return html.length > limit ? `${html.slice(0, limit)}… (${html.length} chars)` : html;
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  // Forwards a log line to the side panel's log area.
  function log(level, text) {
    chrome.runtime.sendMessage({ type: "la:log", level, text }).catch(() => {});
  }

  Object.assign(window.leadsAutomate, {
    humanDelay,
    isVisible,
    queryFirst,
    queryAllFirst,
    waitFor,
    waitForDomQuiet,
    setInputValue,
    typeText,
    pressKey,
    describeElementDetailed,
    truncatedHtml,
    normalizeText,
    log,
  });
})();

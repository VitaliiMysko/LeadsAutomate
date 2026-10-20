window.leadsAutomate = window.leadsAutomate || {};

// Executes single UI steps on the Sales Navigator people-search page on the
// side panel's request. The side panel orchestrates the sequence and checks
// each step's outcome against the tab URL (where Sales Navigator records the
// applied filters), so these handlers only act on the DOM and report back.
if (!window.leadsAutomate.salesSearchInit) {
  window.leadsAutomate.salesSearchInit = true;

  const {
    SELECTORS,
    humanDelay,
    isVisible,
    queryFirst,
    queryAllFirst,
    waitFor,
    waitForDomQuiet,
    setInputValue,
    typeText,
    normalizeText,
    log,
  } = window.leadsAutomate;

  function getFilterFieldset(filterType) {
    const fieldset = queryFirst(document, SELECTORS.filterFieldset(filterType));
    if (!fieldset) {
      throw new Error(`Filter "${filterType}" not found on the page (is the filters panel shown?)`);
    }
    return fieldset;
  }

  async function ensureFilterExpanded(fieldset) {
    const visibleInput = () => queryFirst(fieldset, SELECTORS.filterInput, { visibleOnly: true });
    if (visibleInput()) return visibleInput();

    const expandButton = queryFirst(fieldset, SELECTORS.filterExpandButton);
    if (!expandButton) throw new Error("Filter expand button not found");
    expandButton.click();
    await humanDelay();
    return waitFor(visibleInput, { description: "filter text input" });
  }

  // A selected value's remove button carries the value in its aria-label in
  // every interface language; failing that, take the button next to the
  // value's text.
  function findRemoveButton(fieldset, text) {
    const target = normalizeText(text);
    const byLabel = [...fieldset.querySelectorAll("button[aria-label]")].find((button) =>
      normalizeText(button.getAttribute("aria-label")).includes(target)
    );
    if (byLabel) return byLabel;

    const textElement = [...fieldset.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && normalizeText(element.textContent) === target
    );
    const container = textElement?.closest("li");
    const buttons = container ? container.querySelectorAll("button") : [];
    return buttons.length ? buttons[buttons.length - 1] : textElement?.closest("button") ?? null;
  }

  async function clearFilterValues({ filterType, values }) {
    const fieldset = getFilterFieldset(filterType);
    const notFound = [];
    for (const text of values) {
      const button = findRemoveButton(fieldset, text);
      if (!button) {
        notFound.push(text);
        log("warn", `Remove button for "${text}" not found`);
        continue;
      }
      button.click();
      log("debug", `Clicked remove for "${text}"`);
      await humanDelay();
    }
    return { notFound };
  }

  function getSuggestionOptions(input, fieldset) {
    const listboxId = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    for (const root of [listbox, fieldset, document]) {
      if (!root) continue;
      const options = queryAllFirst(root, SELECTORS.suggestionOption, { visibleOnly: true });
      if (options.length) return options;
    }
    return [];
  }

  function optionLabel(option) {
    return (option.innerText || option.textContent || "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  }

  // Exact name first, then a name starting with it, then containing it,
  // then LinkedIn's own top suggestion.
  function pickBestOption(options, text) {
    const target = normalizeText(text);
    const labelled = options.map((option) => ({ option, label: normalizeText(optionLabel(option)) }));
    return (
      labelled.find(({ label }) => label === target) ||
      labelled.find(({ label }) => label.startsWith(target)) ||
      labelled.find(({ label }) => label.includes(target)) ||
      labelled[0]
    ).option;
  }

  async function addFilterValue({ filterType, text }) {
    const fieldset = getFilterFieldset(filterType);
    const input = await ensureFilterExpanded(fieldset);

    input.click();
    await humanDelay(200, 500);
    await typeText(input, text);
    log("debug", `Typed "${text}", waiting for suggestions`);

    const options = await waitFor(
      () => {
        const found = getSuggestionOptions(input, fieldset);
        return found.length ? found : null;
      },
      { timeout: 10000, description: "typeahead suggestions" }
    ).catch((error) => {
      setInputValue(input, "");
      throw error;
    });

    const option = pickBestOption(options, text);
    const label = optionLabel(option);
    log("debug", `Suggestions: ${options.length}; picking "${label}"`);
    await humanDelay();

    // An option shows separate Include / Exclude buttons, Include first;
    // a plain option includes the value when clicked itself.
    const buttons = [...option.querySelectorAll("button")].filter(isVisible);
    (buttons[0] || option).click();
    await humanDelay();
    input.blur();

    return { selectedText: label };
  }

  async function waitForResults() {
    const container = queryFirst(document, SELECTORS.resultsContainer) || document.body;
    const settled = await waitForDomQuiet(container);
    const items = queryAllFirst(document, SELECTORS.resultItem);
    return { count: items.length, settled };
  }

  const handlers = {
    ping: async () => ({ url: location.href }),
    clearFilterValues,
    addFilterValue,
    waitForResults,
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.action];
    if (!handler || message.target !== "la:content") return;
    handler(message).then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) })
    );
    return true;
  });
}

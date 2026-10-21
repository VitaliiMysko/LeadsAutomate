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

  // Elements of an open typeahead dropdown, whose options carry company
  // names and Include / Exclude labels too: never a selected value.
  const outsideDropdown = (element) => !element.closest('[role="option"], [role="listbox"]');

  // A selected value on the page: the element with its text and its
  // container (a pill). Failing the text, a pill button whose aria-label
  // holds the value (in every interface language) locates it.
  function findSelectedValue(fieldset, text) {
    const target = normalizeText(text);
    const textElement = [...fieldset.querySelectorAll("*")].find(
      (element) =>
        outsideDropdown(element) && element.children.length === 0 && normalizeText(element.textContent) === target
    );
    const labelledButton = [...fieldset.querySelectorAll("button[aria-label]")].find(
      (button) => outsideDropdown(button) && normalizeText(button.getAttribute("aria-label")).includes(target)
    );
    const anchor = textElement || labelledButton;
    const container = anchor?.closest('li, [role="listitem"]') || anchor?.parentElement || null;
    return { textElement, container, found: !!anchor };
  }

  // Diagnostic snapshot of how the given values appear in the filter,
  // logged when removing them without a reload fails.
  async function inspectFilterValues({ filterType, values }) {
    const fieldset = getFilterFieldset(filterType);
    const input = queryFirst(fieldset, SELECTORS.filterInput, { visibleOnly: true });
    return {
      expanded: !!input,
      fieldset: describeElementDetailed(fieldset),
      values: values.map((text) => {
        const { textElement, container, found } = findSelectedValue(fieldset, text);
        return {
          text,
          found,
          textElement: describeElementDetailed(textElement),
          container: describeElementDetailed(container),
          containerButtons: container ? [...container.querySelectorAll("button")].map(describeElementDetailed) : [],
          html: truncatedHtml(container),
        };
      }),
    };
  }

  // Values (of `values`) still shown as selected in the filter.
  async function presentFilterValues({ filterType, values }) {
    const fieldset = getFilterFieldset(filterType);
    return { present: values.filter((text) => !!findSelectedValue(fieldset, text).textElement) };
  }

  // In-page (single-page-app) navigation to `url`: replaces the URL without
  // a reload and fires popstate, which Sales Navigator's router follows like
  // the browser's Back / Forward. undoInPageNavigation restores the previous
  // URL if the app didn't follow.
  let navigationUndo = null;

  async function navigateInPage({ url }) {
    const target = new URL(url);
    const previousState = history.state;
    navigationUndo = { url: location.href, state: previousState };
    const state =
      previousState && typeof previousState === "object"
        ? { ...previousState, path: target.pathname + target.search }
        : previousState;
    history.replaceState(state, "", target.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
    return {};
  }

  async function undoInPageNavigation() {
    if (!navigationUndo) return { restored: false };
    history.replaceState(navigationUndo.state, "", navigationUndo.url);
    navigationUndo = null;
    return { restored: true };
  }

  // Whether the filter is rendered, e.g. after the side panel reloaded the
  // search to clear a filter.
  async function isFilterReady({ filterType }) {
    return { ready: !!queryFirst(document, SELECTORS.filterFieldset(filterType)) };
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

  // The option's first text line is the company name; further lines hold
  // details such as the industry.
  function optionLabel(option) {
    return (option.innerText || option.textContent || "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  }

  function getFilterInput(fieldset) {
    const input = queryFirst(fieldset, SELECTORS.filterInput, { visibleOnly: true });
    if (!input) throw new Error("Filter text input is not open");
    return input;
  }

  // Types `text` into the filter and returns the dropdown's option labels
  // (empty when no suggestions appear). The dropdown stays open, so the side
  // panel can pick an option or leave the choice to the user.
  async function typeFilterValue({ filterType, text }) {
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
    ).catch(() => []);

    // Let late suggestions finish rendering before reading the list.
    if (options.length) await humanDelay(600, 1000);
    return { options: getSuggestionOptions(input, fieldset).map(optionLabel) };
  }

  const HIGHLIGHT_CLASS = /(active|hover|focus|highlight|selected|current)/i;

  // The highlighted option of a freshly read list: aria-selected, or a state
  // class ("artdeco-typeahead__result--highlighted"). aria-activedescendant
  // isn't used: it lags one render behind (it names the highlighted option
  // of the list that was just replaced), so it never matches a current option.
  function highlightState(options) {
    const ariaSelected = options.findIndex((option) =>
      [option, ...option.querySelectorAll("[aria-selected]")].some((element) => element.getAttribute("aria-selected") === "true")
    );
    const byClass = options.findIndex((option) =>
      [option, ...option.querySelectorAll("*")].some((element) => [...element.classList].some((name) => HIGHLIGHT_CLASS.test(name)))
    );
    const highlighted = ariaSelected !== -1 ? ariaSelected : byClass;
    return { highlighted, ariaSelected, byClass };
  }

  function describeHighlight(state) {
    const at = (i) => (i === -1 ? "-" : `#${i + 1}`);
    return `highlighted ${at(state.highlighted)} [aria-selected ${at(state.ariaSelected)}, class ${at(state.byClass)}]`;
  }

  // Selects option `index` (its label checked) with the keyboard, as Sales
  // Navigator ignores script-generated mouse clicks and hovering:
  //
  // - Arrow keys move the highlight from where it is, so it heads for the
  //   target in the right direction.
  // - Enter picks the highlighted option only after an arrow key: Enter on
  //   the highlight the list opens with adds the typed text as free text.
  //   When the target is that initial highlight, it steps away and back (in a
  //   one-option list a key press keeps the highlight in place).
  // - The list is re-rendered (new elements, new ids) on every key, so it's
  //   read again after each one and the target found by its label.
  async function selectSuggestion({ filterType, index, label }) {
    const fieldset = getFilterFieldset(filterType);
    const input = getFilterInput(fieldset);

    const read = () => {
      const options = getSuggestionOptions(input, fieldset);
      const labels = options.map(optionLabel);
      const target = labels[index] === label ? index : labels.indexOf(label);
      return { options, labels, target, state: highlightState(options) };
    };
    const describeList = ({ labels }) => labels.map((text, i) => `#${i + 1} "${text}"`).join(", ");

    let view = read();
    if (view.target === -1) throw new Error(`Option "${label}" is no longer in the dropdown`);

    await humanDelay();
    input.focus();
    log("debug", `Keyboard: target #${view.target + 1} "${label}" of ${describeList(view)}; before: ${describeHighlight(view.state)}`);

    const keys = [];
    const maxPresses = view.options.length * 2 + 2;
    const ready = () => keys.length > 0 && view.state.highlighted === view.target;

    while (!ready() && keys.length < maxPresses) {
      const { state, target, options } = view;
      const position = state.highlighted;
      let key;
      if (position === -1) key = "ArrowDown"; // nothing highlighted: enters the list at #1
      else if (position < target) key = "ArrowDown";
      else if (position > target) key = "ArrowUp";
      else if (options.length === 1) key = "ArrowDown"; // stays on the only option
      else key = target < options.length - 1 ? "ArrowDown" : "ArrowUp"; // step away, then back

      pressKey(input, key);
      keys.push(key === "ArrowDown" ? "↓" : "↑");
      await humanDelay(250, 400);

      const previous = view;
      view = read();
      const reordered = view.labels.join("|") !== previous.labels.join("|");
      log(
        "debug",
        `  after ${key} (${keys.length}): ${describeHighlight(view.state)}, target #${view.target + 1}` +
          (reordered ? ` [list changed: ${describeList(view)}]` : "")
      );
      if (view.target === -1) throw new Error(`"${label}" left the dropdown after ${keys.join("")}`);
    }

    if (!ready()) {
      throw new Error(`couldn't highlight #${view.target + 1} "${label}" (${keys.join("") || "no keys"}): ${describeHighlight(view.state)}`);
    }
    pressKey(input, "Enter");
    return { clicked: `keyboard ${keys.join("")} + Enter on #${view.target + 1}` };
  }

  async function dismissSuggestions({ filterType }) {
    const fieldset = getFilterFieldset(filterType);
    const input = queryFirst(fieldset, SELECTORS.filterInput, { visibleOnly: true });
    if (!input) return {};
    setInputValue(input, "");
    pressKey(input, "Escape");
    input.blur();
    return {};
  }

  async function waitForResults() {
    const container = queryFirst(document, SELECTORS.resultsContainer) || document.body;
    const settled = await waitForDomQuiet(container);
    const items = queryAllFirst(document, SELECTORS.resultItem);
    return { count: items.length, settled };
  }

  const handlers = {
    ping: async () => ({ url: location.href }),
    isFilterReady,
    typeFilterValue,
    selectSuggestion,
    inspectFilterValues,
    presentFilterValues,
    navigateInPage,
    undoInPageNavigation,
    dismissSuggestions,
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

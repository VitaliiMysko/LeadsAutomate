# CLAUDE.md

Vanilla JavaScript Chrome extension (Manifest V3, side panel) with no build step: the source is loaded as-is. See [README.md](README.md) for features and architecture.

## Development

- Load: `chrome://extensions/` → Developer mode → Load unpacked → repo root. After changes, reload the extension, then reload the Sales Navigator tab (content scripts are injected on page load).
- Tests: `npm install` once, then `npm test`. Any new pure function (no DOM, no `chrome.*`) goes in `src/utils/` with a test in `tests/`.

## Rules

- Content scripts (`src/content/`) are classic scripts sharing the `window.leadsAutomate` namespace; side-panel code (`src/sidepanel/`) and `src/utils/` are ES modules.
- Read Sales Navigator search state from the tab URL (`src/utils/restli-query.js`), not from the DOM. Use the URL to verify the outcome of every page step.
- Never match LinkedIn UI text in a single language. Use data-*/ARIA attributes, URL values, or values the user typed. Keep all DOM selectors in `src/content/selectors.js`.
- Every page action must stay human-paced (randomized delays); never remove the pauses.
- Changes to the companion Lead generator extension (`../LeadGenerator`) must be described to the user and approved before they're made, and must respect its Chrome Web Store rules (`.claude/rules/chrome-web-store.md` there).

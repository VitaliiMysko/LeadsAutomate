import { STORAGE_KEYS } from "../../constants/config.js";
import { loadValue, saveValue } from "../store/storage.js";

// Cards marked `data-collapse="<key>"` collapse to their header: a click on
// the header (not on its own buttons) or on the title's toggle hides the rest
// of the card, and the open / closed state of each is remembered by key.
let collapsed = {}; // key → true when collapsed

function setCollapsed(card, toggle, value) {
  card.classList.toggle("card--collapsed", value);
  toggle.setAttribute("aria-expanded", String(!value));
}

// The title becomes a button holding the chevron and the title's text.
function makeToggle(title) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "card__toggle";
  const chevron = document.createElement("span");
  chevron.className = "collapsible__chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(chevron, ...title.childNodes);
  title.replaceChildren(toggle);
  return toggle;
}

export async function initCollapsibleCards(root = document) {
  const stored = await loadValue(STORAGE_KEYS.collapsedCards, {});
  collapsed = stored && typeof stored === "object" ? { ...stored } : {};

  for (const card of root.querySelectorAll(".card[data-collapse]")) {
    const key = card.dataset.collapse;
    const head = card.querySelector(":scope > .card__head");
    const title = head?.querySelector("h2");
    if (!title) continue;
    const toggle = makeToggle(title);
    setCollapsed(card, toggle, collapsed[key] === true);

    head.addEventListener("click", (event) => {
      const control = event.target.closest("button, input, label, a, select");
      if (control && control !== toggle) return;
      const value = !card.classList.contains("card--collapsed");
      setCollapsed(card, toggle, value);
      collapsed = { ...collapsed, [key]: value };
      saveValue(STORAGE_KEYS.collapsedCards, collapsed);
    });
  }
}

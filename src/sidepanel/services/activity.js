// One operation at a time drives the Sales Navigator tab: the company
// searches ("search", search-controls.js) or the companies export
// ("export", company-export.js). Each claims the tab before it starts and
// disables its controls while the other runs.
let owner = null;
const listeners = new Set();

export const currentActivity = () => owner;

// Returns false when another operation is running.
export function startActivity(name) {
  if (owner) return false;
  owner = name;
  listeners.forEach((listener) => listener(owner));
  return true;
}

export function endActivity(name) {
  if (owner !== name) return;
  owner = null;
  listeners.forEach((listener) => listener(owner));
}

export function onActivityChange(listener) {
  listeners.add(listener);
}

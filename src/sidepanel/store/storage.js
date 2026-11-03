export async function loadValue(key, fallback) {
  try {
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveValue(key, value) {
  return chrome.storage.local.set({ [key]: value }).catch(() => {});
}

export function removeValue(key) {
  return chrome.storage.local.remove(key).catch(() => {});
}

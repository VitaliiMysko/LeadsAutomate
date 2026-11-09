// Chrome Web Store API v2 — publishers.items.publish:
// POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:publish
//
// This submits the item for Chrome Web Store review. A successful response
// means the request was accepted, not that the extension is live — Google's
// review still has to pass.
export async function publishItem(client) {
  return client.request(`${client.itemPath}:publish`, { method: "POST" });
}

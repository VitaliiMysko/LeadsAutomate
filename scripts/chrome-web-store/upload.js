// Chrome Web Store API v2 — media.upload:
// POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{extensionId}:upload
// Google's documented example (curl -T $FILE_NAME) sends the zip as a raw
// binary body with no explicit Content-Type (curl defaults to
// application/octet-stream) — matched here rather than declaring
// application/zip, which the docs don't show.
export async function uploadPackage(client, zipBuffer) {
  return client.request(`${client.itemPath}:upload`, {
    method: "POST",
    upload: true,
    headers: { "Content-Type": "application/octet-stream" },
    body: zipBuffer,
  });
}

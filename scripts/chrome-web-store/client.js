// Minimal Chrome Web Store API v2 HTTP client. Deliberately dumb: callers
// (upload.js / status.js / publish.js) know the endpoints, this just attaches
// auth and guarantees errors never carry the access token.
const API_ROOT = "https://chromewebstore.googleapis.com/v2";
const UPLOAD_API_ROOT = "https://chromewebstore.googleapis.com/upload/v2";

export function sanitizeApiError(message, { status, body } = {}) {
  const error = new Error(message);
  error.status = status;
  // `body` is the Store's JSON error payload, not request data, so it's safe
  // to attach — but never attach headers/tokens.
  error.body = body;
  return error;
}

export function createClient({ accessToken, publisherId, extensionId, fetchImpl = fetch }) {
  if (!accessToken) throw new Error("Missing Chrome Web Store access token");
  if (!publisherId) throw new Error("Missing CWS_PUBLISHER_ID");
  if (!extensionId) throw new Error("Missing CWS_EXTENSION_ID");

  const itemPath = `/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;

  async function request(path, { method = "GET", body, headers = {}, upload = false } = {}) {
    const root = upload ? UPLOAD_API_ROOT : API_ROOT;
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...headers },
      body,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      throw sanitizeApiError(`Chrome Web Store API request failed: ${method} ${path} -> HTTP ${response.status}`, {
        status: response.status,
        body: parsed,
      });
    }

    return parsed;
  }

  return { itemPath, request };
}

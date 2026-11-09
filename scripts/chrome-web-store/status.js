// Chrome Web Store API v2 — publishers.items.fetchStatus:
// GET https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:fetchStatus
//
// The response's only upload-related field is lastAsyncUploadState, and per
// Google's own reference docs it is "only set when there has been an async
// upload for the item" — i.e. it is never set at all for an upload that
// completed synchronously. Callers must only poll this when the :upload
// response itself reported UPLOAD_IN_PROGRESS (see run-upload.js); polling
// unconditionally waits out the full timeout for a field that may simply
// never appear.
const IN_PROGRESS_STATES = new Set(["UPLOAD_IN_PROGRESS"]);

export async function fetchUploadStatus(client) {
  return client.request(`${client.itemPath}:fetchStatus`, { method: "GET" });
}

// True once a state is anything other than "still working" — covers both
// the :upload response's own uploadState (checked first, since a
// synchronous upload never needs fetchStatus at all) and, when polling is
// needed, fetchStatus's lastAsyncUploadState.
export function isTerminalUploadState(state) {
  return Boolean(state) && !IN_PROGRESS_STATES.has(state);
}

// Confirmed against a real :upload response: the actual value is
// "SUCCEEDED", not "SUCCESS" as Google's prose summary earlier suggested.
// "SUCCESS" is kept alongside it in case fetchStatus's lastAsyncUploadState
// ever uses a different literal than :upload's own uploadState for the same
// outcome — cheap to allow both, and this exact kind of undocumented enum
// mismatch is what caused the last two failures.
const SUCCESS_STATES = new Set(["SUCCEEDED", "SUCCESS"]);

export function isSuccessUploadState(state) {
  return SUCCESS_STATES.has(state);
}

export async function pollUploadStatus(
  client,
  { intervalMs = 5000, timeoutMs = 120000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}
) {
  const deadline = now() + timeoutMs;

  while (true) {
    const status = await fetchUploadStatus(client);
    const state = status.lastAsyncUploadState ?? null;

    if (state && !IN_PROGRESS_STATES.has(state)) {
      return status;
    }

    if (now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the Chrome Web Store upload to finish processing (last lastAsyncUploadState: ${state ?? "not set"})`
      );
    }

    await sleep(intervalMs);
  }
}

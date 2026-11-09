// CI-only entry point: authenticates and uploads the built package, then
// polls fetchStatus until the upload finishes processing. Intended to run
// only from .github/workflows/release-chrome-web-store.yml, inside the
// protected "production" GitHub Environment.
//
// Usage: node scripts/chrome-web-store/run-upload.js <path-to-zip>
// Required env: CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAccessToken } from "./auth.js";
import { createClient } from "./client.js";
import { uploadPackage } from "./upload.js";
import { pollUploadStatus, isTerminalUploadState, isSuccessUploadState } from "./status.js";

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    throw new Error("Usage: node scripts/chrome-web-store/run-upload.js <path-to-zip>");
  }

  const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
  if (!CWS_SERVICE_ACCOUNT_KEY) throw new Error("Missing required secret: CWS_SERVICE_ACCOUNT_KEY");
  if (!CWS_PUBLISHER_ID) throw new Error("Missing required variable: CWS_PUBLISHER_ID");
  if (!CWS_EXTENSION_ID) throw new Error("Missing required variable: CWS_EXTENSION_ID");

  const accessToken = await getAccessToken(CWS_SERVICE_ACCOUNT_KEY);
  console.log("✓ Chrome Web Store authentication succeeded");

  const client = createClient({ accessToken, publisherId: CWS_PUBLISHER_ID, extensionId: CWS_EXTENSION_ID });

  const zipBuffer = readFileSync(zipPath);
  const uploadResult = await uploadPackage(client, zipBuffer);
  console.log(
    `✓ Package upload request completed (uploadState: ${uploadResult.uploadState ?? "not set"}, crxVersion: ${uploadResult.crxVersion ?? "not set"})`
  );

  // The :upload response's own uploadState is authoritative when it's
  // already terminal — a synchronous upload never populates fetchStatus's
  // lastAsyncUploadState at all, so only poll when genuinely still working.
  let state = uploadResult.uploadState;
  if (!isTerminalUploadState(state)) {
    const intervalMs = Number(process.env.CWS_STATUS_POLL_INTERVAL_MS) || 5000;
    const timeoutMs = Number(process.env.CWS_STATUS_POLL_TIMEOUT_MS) || 120000;
    const status = await pollUploadStatus(client, { intervalMs, timeoutMs });
    state = status.lastAsyncUploadState;
    console.log(`  fetchStatus lastAsyncUploadState: ${state ?? "not set"}`);
  }

  if (!isSuccessUploadState(state)) {
    throw new Error(`Chrome Web Store reported upload state "${state ?? "UNKNOWN"}", expected "SUCCESS"`);
  }

  console.log(`✓ Chrome Web Store upload status: ${state}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Upload failed: ${err.message}`);
    // err.body is the Chrome Web Store API's own JSON error payload — never
    // request data or credentials — so it's safe to print and is usually the
    // only way to tell what Google actually rejected.
    if (err.body) {
      console.error(`  API response: ${JSON.stringify(err.body)}`);
    }
    process.exit(1);
  });
}

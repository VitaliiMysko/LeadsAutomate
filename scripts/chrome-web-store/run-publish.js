// CI-only entry point: authenticates and publishes the previously uploaded
// item. Intended to run only from .github/workflows/release-chrome-web-store.yml,
// inside the protected "production" GitHub Environment, and only after
// run-upload.js has reported a SUCCESS status.
//
// Required env: CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID
import { pathToFileURL } from "node:url";
import { getAccessToken } from "./auth.js";
import { createClient } from "./client.js";
import { publishItem } from "./publish.js";

async function main() {
  const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
  if (!CWS_SERVICE_ACCOUNT_KEY) throw new Error("Missing required secret: CWS_SERVICE_ACCOUNT_KEY");
  if (!CWS_PUBLISHER_ID) throw new Error("Missing required variable: CWS_PUBLISHER_ID");
  if (!CWS_EXTENSION_ID) throw new Error("Missing required variable: CWS_EXTENSION_ID");

  const accessToken = await getAccessToken(CWS_SERVICE_ACCOUNT_KEY);
  console.log("✓ Chrome Web Store authentication succeeded");

  const client = createClient({ accessToken, publisherId: CWS_PUBLISHER_ID, extensionId: CWS_EXTENSION_ID });

  const result = await publishItem(client);
  console.log("✓ Publish request submitted");
  console.log(`  state: ${result.state ?? "not set"}`);
  if (result.warningInfo?.warnings?.length) {
    console.log(`  warnings: ${JSON.stringify(result.warningInfo.warnings)}`);
  }
  console.log("✓ Chrome Web Store review initiated (this does not mean the extension is live yet)");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Publish failed: ${err.message}`);
    if (err.body) {
      console.error(`  API response: ${JSON.stringify(err.body)}`);
    }
    process.exit(1);
  });
}

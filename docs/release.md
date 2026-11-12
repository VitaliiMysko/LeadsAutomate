# Chrome Web Store Release Pipeline

How this extension gets from `master` to a published Chrome Web Store release, and what has to be configured in GitHub for it to work.

The Chrome Web Store is the only automated store. Microsoft Edge users install from it too (with Edge's "Allow extensions from other stores"). The same package can't be submitted to the Microsoft Edge Add-ons store as-is: Partner Center rejects an MV3 manifest containing `background.scripts`, which is kept for Firefox. An Edge Add-ons release would need a separate package without `background.scripts` (and `browser_specific_settings`), a Partner Center account, and its own listing.

## Branches

- **`master`** — development branch. `.github/workflows/test.yml` runs the unit test suite and validates `docs/chrome-web-store/` on every push/PR. It never touches the Chrome Web Store and never needs Store credentials.
- **`prod`** — the branch that *is* the current Chrome Web Store submission. A push to `prod` (normally merging a "release" PR from `master` into `prod` with a bumped `manifest.json` version) runs `.github/workflows/release-chrome-web-store.yml` end to end. A PR *into* `prod` (before it's merged) only runs the `validate` job, so its checks are visible on the PR itself — see below.

## Release workflow

`.github/workflows/release-chrome-web-store.yml` runs these jobs in sequence. It triggers on a push to `prod`, on `workflow_dispatch` (also restricted to `prod`), and on a pull request targeting `prod` — but a PR run stops after `validate`: `build`, `upload`, `listing-sync-checkpoint`, and `publish` all require the event to be a push/`workflow_dispatch`, so opening or updating a PR never builds a package, never touches Store credentials, and never approaches the `production` environment. Its only purpose is to surface a failing test, an invalid docs file, or a missed version bump on the PR's Checks tab, before merge.

1. **validate** — re-runs the unit tests and the Chrome Web Store docs validator (never trust that `master` already passed), fails the run if `manifest.json`'s version wasn't increased relative to the previous commit on `prod`, and checks whether `docs/chrome-web-store/` changed relative to the previous commit on `prod` (see "Listing sync checkpoint" below). No Store credentials involved. Runs on both a PR into `prod` and an actual push to `prod`.
2. **build** — copies the extension's actual runtime files (`manifest.json`, `sidepanel.html`, `assets/`, `src/`) into `release/`, drops the manifest `key` (the Store gives the item its own id and rejects a package with one), checks the result doesn't contain anything it shouldn't (`node_modules`, `tests`, dev-only files, etc.), zips it, and uploads the zip as a workflow artifact. No Store credentials involved.
3. **upload** — authenticates to the Chrome Web Store API and uploads the package, then polls the upload status until it resolves. Runs under the `production` GitHub Environment, so it requires manual approval.
4. **listing-sync-checkpoint** — *only runs if `docs/chrome-web-store/` changed since the last release.* Runs under `production` too, so it requires its own manual approval, and makes no API calls itself — approving it is the developer's sign-off that they've already copied the changed listing text into the Chrome Web Store Developer Dashboard. Skipped entirely (no approval needed) when the listing docs didn't change.
5. **publish** — authenticates again and submits the item for Chrome Web Store review. Also runs under `production`, so it requires a manual approval — given after you've seen the upload succeed, and after the listing-sync checkpoint (if it ran).

Every job under `production` needs the same credential, and GitHub Environment approval gates a whole job rather than a step inside one, so there's no way to have upload run unattended while only publish is gated without either duplicating the secret across environments or accepting one approval click per gated job. This pipeline takes the multiple-click option: one secret location, and a human confirms each step before the irreversible `publish` call — normally two clicks (upload, publish), three when the listing docs changed (upload, listing sync, publish).

Publishing submits the item for Google's review — it does **not** mean the extension is immediately live for users.

## After merging a release PR — what to actually do

Merging the PR into `prod` does **not** finish the release by itself, and GitHub does not notify you that anything is waiting — you have to go look:

1. Go to the repo's **Actions** tab and open the new **Release to Chrome Web Store** run (or open it straight from the merge commit's status check).
2. `validate` and `build` run immediately, no approval needed. Once `build` finishes, the run pauses — its job summary (visible right on the run page) says so and tells you what to do next.
3. Click **Review deployments** (a banner near the top of the run page), check **production**, click **Approve and deploy**. This unblocks `upload`.
4. Repeat step 3 for each subsequent paused job. Each job's summary says exactly what's next: usually `upload` → `publish` (two approvals), or `upload` → `listing-sync-checkpoint` → `publish` (three) if the Store listing docs changed — in which case that job's summary also tells you to update the Developer Dashboard *before* approving it.
5. Once `publish` finishes, its summary confirms the submission and reminds you it's not live yet — Google's review still has to run. If the Chrome Web Store Developer Dashboard still shows a clickable **Submit for review** button right after, try a hard refresh before assuming anything went wrong — that's been a stale-UI quirk here before, not an actual failure.

If you don't see a **Review deployments** banner and a job just looks stuck, you're probably not looking at the run itself — open it from the Actions tab, not the PR's checks list.

## Listing sync checkpoint

The Chrome Web Store API v2 can't update the listing description, single-purpose text, or privacy justifications (see below) — those still have to be pasted into the Developer Dashboard by hand. To make that hard to forget, `validate` diffs `docs/chrome-web-store/` against the previous `prod` commit (`scripts/chrome-web-store/detect-listing-changes.js`) and, if anything changed, the pipeline inserts an extra `production`-gated approval between `upload` and `publish` that exists purely as a checklist item — approve it once you've actually updated the Dashboard. If the diff can't be determined (e.g. no parent commit), it fails safe and requests the approval anyway. If nothing changed, the checkpoint is skipped and the pipeline goes straight from upload to publish, same as before.

## Required GitHub configuration

Create a GitHub Environment named `production` (Settings → Environments) with required reviewers configured, then add:

**Secrets** (Environment secrets on `production`, never repository secrets, never committed anywhere):

| Name | Description |
|---|---|
| `CWS_SERVICE_ACCOUNT_KEY` | The full JSON key of the Google Cloud Service Account linked to the Chrome Web Store publisher. |

**Variables** (Environment variables on `production` — not secret, but not hard-coded into the workflow or source either):

| Name | Description |
|---|---|
| `CWS_PUBLISHER_ID` | Publisher ID, from the Chrome Web Store Developer Dashboard → Publisher settings. |
| `CWS_EXTENSION_ID` | The extension's item ID in the Chrome Web Store. |

### Google Cloud Service Account setup

1. In Google Cloud Console, enable the **Chrome Web Store API**.
2. Create a Service Account (no IAM roles are required on the account itself).
3. Create a JSON key for it and store its contents in the `CWS_SERVICE_ACCOUNT_KEY` secret above.
4. In the Chrome Web Store Developer Dashboard, in **Publisher settings**, add the service account's email as the publisher's linked service account. A publisher can only have one.

When this extension is published under the same publisher as Lead generator, it reuses the same service account, key and `CWS_PUBLISHER_ID`; only `CWS_EXTENSION_ID` differs.

## First release (one-time)

The API can only update an item that already exists, so the first package is uploaded by hand:

1. `npm run release:chrome -- --dry-run` builds `release/leads-automate-v<version>.zip`.
2. Developer Dashboard → **Add new item** → upload the zip. The item gets its ID; set it as `CWS_EXTENSION_ID`.
3. **Store listing**: paste `docs/chrome-web-store/description.md`, choose a category and language, add the 128×128 icon (`assets/icons/logo-128.png`) and at least one screenshot (1280×800 or 640×400).
4. **Privacy**: paste `single-purpose.md` and each `privacy/*.md` into its field; answer "No" to remote code; under data usage declare the data the extension handles (website content, and personally identifiable information for the lead names it reads from the page) and confirm the three certifications; give the privacy policy URL: https://vitaliimysko.github.io/LeadsAutomate/PRIVACY_POLICY.html (served by GitHub Pages from `master`; a github.com file link was rejected by review as not leading directly to a privacy policy).
5. **Distribution** → Visibility **Private**: either the publisher's Google Workspace domain, or **Trusted testers**, whose Google account emails are listed in the Dashboard's account settings. Only those accounts can see and install the extension.
6. **Submit for review**.
7. Add the new item ID to Lead generator's `COMPANION_EXTENSION_IDS` and release Lead generator: it answers only extension ids it knows.
8. Create the `prod` branch from the released commit. Later releases go through the workflow above.

An install from the Store has a different id from the unpacked copy (fixed by the manifest `key`), so its stored data (job-title board, companies list, logos) starts empty: **Save to file** the job titles in the unpacked copy and load them in the Store one.

## Chrome Web Store API v2 — what's actually automated

This pipeline uses `chromewebstore.googleapis.com/v2` (`upload`, `fetchStatus`, `publish`) via a service-account JWT-bearer token, scope `https://www.googleapis.com/auth/chromewebstore`. The old `v1.1` API is not used.

**Automated:** package upload, upload-status polling, publish.

**Not automated — the v2 API has no endpoint for it:** the Store listing description, single-purpose declaration, and privacy/permission justification text. `docs/chrome-web-store/` remains the canonical source for that content, but it still has to be pasted into the Developer Dashboard by hand whenever it changes — the pipeline detects when that's needed (see "Listing sync checkpoint" above) but cannot do the copy itself. Run `npm run validate:chrome-store` to confirm those files are still well-formed before doing so.

## Manifest version check

The Chrome Web Store API v2 has no "get currently published version" call. Instead, the `validate` job compares `manifest.json`'s `version` field on the new `prod` commit against `manifest.json` on the commit `prod` pointed to before this push, and fails if it wasn't strictly increased. `manifest.json` version bumps are made manually as part of the release PR, following the project's existing convention — this pipeline doesn't bump versions automatically.

## Running it locally

```bash
npm run validate:chrome-store          # docs validator only
npm run release:chrome:validate-version # manifest version-bump check (compares against the previous commit)
npm run release:chrome -- --dry-run    # both of the above, plus build + package + package validation
```

`release:chrome` never authenticates, uploads, or publishes — those calls only happen from the `upload`/`publish` jobs above, under the `production` environment, in CI.

## After `publish`

A successful `publish` call means Google accepted the submission for review — nothing more. The extension is not live yet. Review time varies; check the Developer Dashboard for the item's actual status.

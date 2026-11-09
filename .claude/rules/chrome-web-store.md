# Chrome Web Store Documentation Rule

`docs/chrome-web-store/` is the canonical, external-facing source of truth for the extension's Chrome Web Store listing content:

```text
docs/chrome-web-store/
├── description.md          Store listing "Description" field
├── single-purpose.md       Store "Single Purpose" justification
└── privacy/
    ├── <permission>.md     One file per entry in manifest.json "permissions"
    └── host-permissions.md Justification for host_permissions / content_scripts host access
```

Treat everything under this directory as visible to Chrome Web Store reviewers and, indirectly, to end users. Write it from the user's perspective: what the extension does and why it needs a permission — never class/function/file names, internal modules, call chains, or implementation algorithms. This directory is not general project documentation; do not add files here beyond the structure above.

## When to update

`manifest.json` is authoritative for permissions and host access. After any change that touches it or user-facing functionality, check whether the following still apply and update only what changed:

| Change | Action |
|---|---|
| Permission added to `manifest.json` | Create `privacy/<permission>.md` |
| Permission removed from `manifest.json` | Delete `privacy/<permission>.md` |
| A permission's purpose/usage changes | Update `privacy/<permission>.md` |
| `host_permissions` / `optional_host_permissions` / `content_scripts` hosts change | Update `privacy/host-permissions.md` |
| User-facing functionality changes | Update `description.md` if the change is significant enough to affect the listing |
| The extension's core purpose changes | Review `single-purpose.md` |

Do not touch unaffected files just because a related file changed.

## Limits

Each file has a hard character limit (Chrome Web Store field limits): `description.md` ≤ 16,000, `single-purpose.md` ≤ 1,000, every `privacy/*.md` file ≤ 1,000. Verify with:

```
npm run validate:chrome-store
```

Run this validator after any change to `docs/chrome-web-store/` or to `manifest.json` permissions/host access. It also fails on missing required files or obsolete permission files no longer in the manifest.

`README.md` is the developer documentation and `PRIVACY_POLICY.md` the privacy policy; keep listing text out of both.

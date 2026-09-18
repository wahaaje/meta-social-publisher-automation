# Security Policy

## Scope

This repository is a self-hosted Google Apps Script publisher. It reads approved media from Google Drive, reads and updates a Google Sheets queue, and sends publishing requests to Meta's Graph API. The maintainers do not operate a shared service and should never receive your credentials.

## Report a vulnerability

Do not put tokens, private media, production IDs, queue exports, or screenshots containing credentials in a public issue. Use GitHub's private security-advisory flow. If a live credential may be exposed, revoke it before reporting.

## Secrets and sensitive data

Never commit or paste these items into source, Sheets, documentation, issues, screenshots, CI logs, or Git history:

- Meta user or Page access tokens
- Meta app secrets, client secrets, or private keys
- Google OAuth tokens, service-account JSON, API keys, or deployment credentials
- production spreadsheet, Drive folder, Page, Instagram, Business Portfolio, or app IDs
- saved publication-state JSON and private remote IDs
- customer media, unpublished copy, or production queue exports

The publisher stores the Page token in `PropertiesService.getUserProperties()`. Only non-secret coordination values are stored in Script Properties. The token is never returned to `Settings.html`, written to the Sheet, placed in a query string, or intentionally logged.

User Properties reduce accidental disclosure but are not a dedicated secret vault. Any editor who can change the bound Apps Script may be able to make the trigger owner execute altered code. Treat every spreadsheet and script editor as a publisher administrator.

## Access model

- Use a dedicated Google account where practical and require multi-factor authentication.
- Restrict the spreadsheet, Apps Script project, and media folder.
- Install the trigger from the account responsible for the automation.
- Remove that user's trigger and rotate the Meta token when responsibility changes.
- Require strong Meta Business security and least-privilege Page access.
- Do not deploy this project as a public web app.

## Least-privilege Google scopes

| Scope | Purpose |
| --- | --- |
| `spreadsheets` | Read and update the configured queue by spreadsheet ID |
| `drive.readonly` | Read configured media without editing Drive |
| `script.external_request` | Call Meta Graph and upload endpoints |
| `script.scriptapp` | Create and remove the scheduled trigger |
| `script.container.ui` | Add the menu and setup dialog |

Do not add Gmail, Calendar, full Drive, or unrelated scopes. `spreadsheets.currentonly` is insufficient because the trigger uses `SpreadsheetApp.openById()`.

Typical Meta permissions for this workflow are `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, and `instagram_content_publish`; `pages_show_list` may be needed during token selection. Request `business_management` only when the asset-discovery flow requires it. Confirm current requirements in Meta's official documentation.

## Network and input safeguards

- Send the Meta token only in an HTTPS `Authorization` header.
- Allowlist exact Meta hosts and resource shapes.
- Do not accept request URLs from the Sheet or setup form.
- Disable redirects on authenticated requests.
- Verify the exact Page identity and linked Instagram account during setup.
- Validate schema, IDs, dates, approval, media paths, MIME types, magic bytes, and size limits.
- Use `textContent`, never `innerHTML`, for server-returned labels in the setup dialog.
- Do not log raw Meta responses, request options, tokens, or settings forms.

## Publishing controls

The implementation fails closed:

- only `APPROVED` rows start new remote work
- preview and validation do not publish
- unresolved variable-date rows are blocked
- a row is re-read before every remote mutation
- prepared content is protected by a signature
- intent and a unique operation ID are saved before each mutation
- one script lock and one verified trigger owner advance state
- uncertain publication is verified or stopped for review, never blindly replayed
- remote IDs and terminal states remain in the queue

Pausing stops future checks but cannot cancel a request already accepted by Meta.

## Media privacy

Instagram images may be staged as unpublished photos on the connected Facebook Page so Instagram can fetch a Meta-hosted URL. Those bytes leave Drive and may remain in Meta's systems. Do not use this workflow for confidential media.

## Token lifecycle

A token shown as `Never` expiring can still become invalid after permission, password, role, app, Page-linkage, Business Portfolio, or security changes. Review execution failures and rotate credentials after role changes or suspected exposure.

## Incident response

1. Pause the scheduled trigger. Assume an already-sent request may still complete.
2. Revoke the affected Meta credential or Business Integration.
3. Audit public posts, Meta Business activity, the Sheet, Apps Script executions, project editors, and Drive sharing.
4. Generate a replacement Page token with minimum permissions.
5. If a secret reached Git, rotate it first, then purge it from all commits, tags, releases, forks, and CI logs.
6. Do not reset publication state until both Meta profiles have been checked for duplicates or partial completion.

## Deployment checklist

- [ ] No production credentials, IDs, media, state JSON, or queue exports are in the repository or history.
- [ ] The Page token belongs to the expected Page and linked Instagram account.
- [ ] Google and Meta permissions are the minimum required.
- [ ] Only trusted administrators can edit the Sheet, script, and Drive folder.
- [ ] All sample rows are `DRAFT` with blank state and remote-ID fields.
- [ ] Validation and preview pass before enabling the trigger.
- [ ] One test row is confirmed on both platforms before batch approval.
- [ ] No other publisher acts on the same queue.
- [ ] The pinned Graph API version has not reached deprecation.

## References

- [Apps Script authorization](https://developers.google.com/apps-script/guides/services/authorization)
- [Apps Script scopes](https://developers.google.com/apps-script/concepts/scopes)
- [Properties Service](https://developers.google.com/apps-script/guides/properties)
- [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Meta access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)

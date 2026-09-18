# Troubleshooting

| Symptom | Checks |
| --- | --- |
| “No action is due within the next 60 minutes” | Confirm `APPROVED`, timezone, timestamp, verification value, and platform status. The preview window is not the scheduler's lifetime. |
| `SpreadsheetApp.openById` permission error | Confirm the manifest uses the full spreadsheets scope, run a menu function manually, accept authorization, then recreate the trigger if necessary. |
| Page is absent from a token selector | Confirm the signed-in Facebook user, Page access, app, Business Portfolio, and authorization; then regenerate the token. |
| Page-token verification fails | Check token type, app, permissions, selected Page, account access, and revocation or expiry. |
| Instagram account is missing | Confirm it is a professional account linked to the selected Facebook Page. |
| Media is not found | Check the Drive root, relative path, capitalization, duplicate folder/file names, and Google account access. |
| Only one platform published | Inspect each platform independently. Never clear the successful platform's state. |
| Reel remains processing | Wait for Meta processing, then inspect codec, duration, size, aspect ratio, and current platform limits. |
| Carousel is rejected | Check item count, JPEG MIME types, image dimensions, ordering, and current Meta constraints. |
| Caption looks unusual | Platforms render plain text, not Markdown. Test line breaks, Unicode, links, and emoji with one post. |
| A `Never` token stopped working | Check revoked access, roles, password/security events, app ownership, Page linkage, and Business Portfolio changes. |
| Duplicate risk after timeout | Check public profiles and stored remote IDs before resetting or retrying. |
| Variable-date row is blocked | Research the current official date, then change the flag to `VERIFIED; DATE RECONFIRMED`. |
| Setup dialog never displays the saved token | This is intentional. Leave the token field blank to keep it, or enter a replacement. |
| Custom Instagram Reel cover fails | Leave column L blank and retest with the default thumbnail offset; `cover_url` behavior can vary by API version and account. |

## Authorization reset

If scopes changed:

1. pause posting
2. save the Apps Script project
3. run **Show connection and run status** or **Validate approved rows** manually
4. accept the new Google authorization prompt
5. validate and preview
6. enable posting again, which creates a fresh trigger owned by the authorized user

## Do not “fix” uncertainty by clearing cells

State, remote IDs, and pending actions are evidence. Clearing them can turn an uncertain single publication into a duplicate. Always inspect Meta first and preserve the platform that already succeeded.

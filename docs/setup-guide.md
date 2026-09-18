# Setup guide

This guide installs the publisher as a bound Google Apps Script project. Complete one controlled test before approving a batch.

## 1. Prepare Google Sheets

1. Create a new Google Sheet.
2. Import [`templates/publishing-queue.csv`](../templates/publishing-queue.csv).
3. Rename the tab to `Publishing Queue` exactly.
4. Open **File → Settings** and choose the required timezone. For Pakistan, select `(GMT+05:00) Karachi`; the locale can remain another available English locale.
5. Format column D as plain text.
6. Keep every sample row `DRAFT`.

The accepted timestamp formats are:

- `YYYY-MM-DD HH:mm`, interpreted in the configured publisher timezone
- an ISO-8601 timestamp containing an explicit offset, such as `2026-09-21T07:30:00+05:00`

Do not mix locale formats such as `17/09/2026 14:30` into the queue.

## 2. Prepare Google Drive

Create one campaign root folder. The queue stores paths relative to that root.

```text
Campaign_Media/
├── 02_Single_Image_Posts/
│   └── DEMO-001.jpg
├── 03_Carousels/
│   └── DEMO-002/
│       ├── DEMO-002-01.jpg
│       └── DEMO-002-02.jpg
└── 04_Reels/
    └── DEMO-003/
        └── DEMO-003.mp4
```

Rules:

- preserve capitalization
- avoid duplicate folder or file names at the same level
- do not use absolute paths or `..`
- grant access only to trusted operators
- do not replace media after remote preparation begins
- use only media you own or are licensed to publish

## 3. Prepare Meta

You need:

- sufficient control of the intended Facebook Page
- a professional Instagram account linked to that Page
- a Meta app owned by the intended business portfolio
- a Page access token created through that app by an authorized person

Typical publishing permissions include:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

Request `business_management` only when the selected asset-discovery or Business Portfolio flow requires it. Permission requirements and Meta interfaces change; confirm the current official documentation before production use.

Use a Page token for the intended Page, not a user token. During setup, the publisher calls `/me` and verifies the exact Page name plus the linked Instagram professional account.

A token shown as `Never` expiring can still stop working after password, security, role, Page linkage, app, or business-asset changes.

## 4. Install the Apps Script project

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Create these script files and paste the matching repository content:
   - `Code.gs`
   - `Config.gs`
   - `Core.gs`
   - `Drive.gs`
   - `Meta.gs`
   - `Worker.gs`
3. Add an HTML file named `Settings` and paste `Settings.html`.
4. Open **Project Settings** and enable **Show appsscript.json manifest file in editor**.
5. Replace the manifest with [`appsscript/appsscript.json`](../appsscript/appsscript.json).
6. Save all files.
7. Return to the spreadsheet and reload it.

Do not deploy the project as a public web app. The intended interface is the bound spreadsheet menu and modal dialog.

## 5. Connect Drive and Meta

1. Open **Meta Publisher → Install queue dropdowns and formatting**.
2. Open **Meta Publisher → Setup and connect**.
3. Enter:
   - the Drive campaign folder link or ID
   - the exact Facebook Page name
   - the Meta Page access token
   - an IANA timezone such as `Asia/Karachi`
4. Select **Verify and save**.
5. Complete Google's authorization prompt.

The manifest intentionally uses full spreadsheet access because the installed trigger reopens the queue with `SpreadsheetApp.openById()`.

## 6. Launch with one controlled row

1. Replace one sample row with owned media and approved copy.
2. Schedule it at least 10–15 minutes ahead.
3. Change only that row to `APPROVED`.
4. Run **Validate approved rows**.
5. Run **Preview next action**.
6. Confirm no other Apps Script, n8n workflow, Meta scheduler, or service is publishing the same queue.
7. Choose **Enable automatic posting**.
8. Confirm the result on both public profiles.
9. Only then approve a larger stable batch.
10. Repeat the controlled test for each format you plan to use: single image, carousel, and Reel. Test an Instagram custom cover separately before relying on it.

Keep event rows marked `VERIFIED; VARIABLE DATES FLAGGED` as `DRAFT` until current official dates are researched and reconfirmed.

## 7. Optional local development with clasp

The repository includes `.clasp.json.example`. Copy it to `.clasp.json`, insert a development Apps Script project ID, and keep `.clasp.json` uncommitted.

Never use a production project ID in a public repository or test unreviewed code against production social accounts.

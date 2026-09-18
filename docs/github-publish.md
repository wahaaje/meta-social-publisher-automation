# Publish this project to GitHub

Recommended repository name:

`meta-social-publisher-automation`

Recommended description:

> Approval-gated Facebook and Instagram publishing from Google Sheets and Drive, powered by Apps Script and the Meta Graph API.

Recommended topics:

`google-apps-script`, `meta-graph-api`, `instagram-api`, `facebook-api`, `google-sheets`, `google-drive`, `social-media-automation`

## Option A: GitHub website

1. Extract the ZIP locally.
2. Sign in to GitHub and select **New repository**.
3. Use the recommended name and description.
4. Choose public or private.
5. Do not initialize the repository with a README, license, or `.gitignore`; they are already included.
6. Create the repository.
7. On the empty-repository page, choose **uploading an existing file**.
8. Drag the extracted repository contents, including hidden files such as `.gitignore` and `.github`, into the upload area.
9. Use the commit message `Initial public release`.
10. Open the rendered README and verify the preview image, Mermaid diagram, and links.
11. Enable GitHub secret scanning and push protection if available for the account.

## Option B: Git command line

From the extracted project directory:

```bash
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/meta-social-publisher-automation.git
git push -u origin main
```

If the delivered ZIP already contains `.git`, start from `git remote add origin` after reviewing `git status` and the initial commit.

## Before the first push

```bash
npm test

rg -n --hidden --glob '!.git/**' \
  -e 'EA[A-Za-z0-9]{20,}' \
  -e 'AIza[0-9A-Za-z_-]{35}' \
  -e '1//[0-9A-Za-z_-]{20,}' \
  -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' .
```

Review every hit. Also search for any exact production IDs or token fragments known to the project owner.

## Suggested first release

After the repository is online:

1. create a tag named `v1.0.0`
2. title the release `Meta Social Publisher Automation v1.0.0`
3. summarize the formats, approval gate, recovery model, and case study
4. attach the sanitized source ZIP only
5. do not attach a production Sheet export, Apps Script project backup, or media folder

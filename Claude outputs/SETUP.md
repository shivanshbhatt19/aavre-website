# Aavre Ops Console: go-live steps

About 15 minutes. Do every step while signed in to the **dedicated Aavre Google account**.

## 1. Create the backend (Apps Script)

1. Go to script.google.com and click **New project**. Rename it to **Aavre Ops API**.
2. Delete everything in `Code.gs`. Paste in the full contents of the `Code.gs` file from this folder, then click Save.
3. Pick **setup** in the function dropdown at the top and click **Run**. Approve the permissions when Google asks.
4. Open **Execution log**. It shows three things:
   - the **Aavre_Ops** data Sheet link
   - the **Aavre_Ops_Auth** Sheet link
   - your username (`shivansh`) and a **temporary password**. Copy the password.
5. Click **Deploy → New deployment → Select type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click Deploy and copy the **Web app URL** (it ends in `/exec`).

"Anyone" only means the page can reach the script. Every request still needs a valid login.

## 2. Connect the page

1. Open `ops-k7m2x/index.html` in the aavre-website repo.
2. Find `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` near the top of the script. Replace it with the Web app URL, keeping the quotes.
3. Commit and push from GitHub Desktop.
4. The console is now live at **https://aavre.in/ops-k7m2x/**.

Do **not** add this page to sitemap.xml, llms.txt or any menu, and do not request indexing for it. The page tells search engines not to index it.

## 3. First login

1. Open the page and log in as `shivansh` with the temporary password.
2. Set your own password (at least 10 characters).
3. Go to **Settings → Cars** and add the 4 cars. Then go to **Settings → Drivers** and add the drivers.
4. Go to **Settings → Users** and add Bharat and Diksha, each with a temporary password. Send each person their password separately.

## 4. Lock down the Sheets

1. **Aavre_Ops_Auth**: share it with no one, ever.
2. **Aavre_Ops**: share it with named team emails as **Viewer**. All edits should go through the console so the audit trail stays complete.
3. Turn on **2-step verification** on the Aavre Google account.

## Good to know

- **Updating the backend later:** paste the new code, then go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Do not create a new deployment, because that changes the URL.
- **Lost super admin password, or locked out:** in Apps Script, run **resetSuperAdmin** and read the new temporary password in the Execution log.
- **Optional cleanup:** in Apps Script, go to **Triggers → Add trigger** and run `cleanSessions` daily. This clears expired logins from the Auth Sheet.
- **Lost phone or suspected leak:** go to **Settings → Users → Sign out everyone**.

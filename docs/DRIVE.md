# Google Drive backups: setting up the client IDs

Drive backups are built (src/drive.js on keel's drive.js), but Google only
lets an app sign in with its own OAuth client. Until `WEB_CLIENT` in
src/drive.js holds one, Settings shows no Google Drive row.

Use the same Google Cloud project as Tripboard's map key, or a new one.

1. **APIs & Services → Library**: turn on **Google Drive API**.
2. **Google Auth Platform → Branding**: app name "Tripboard", a support
   email, and the authorised domain `danielnoam.github.io`.
3. **Audience**: External. While it's in Testing, add your own Google
   account under Test users (only test users can sign in, and their
   sign-in is asked again every 7 days). **Publish app** lifts both; the
   drive.file scope needs no Google review.
4. **Data Access → Add or remove scopes**: `.../auth/drive.file`.
5. **Clients → Create client → Web application**:
   - Authorised JavaScript origins: `https://danielnoam.github.io` and,
     for local testing, `http://localhost:5173`.
   - Authorised redirect URIs: `https://danielnoam.github.io/Tripboard/`
     and `http://localhost:5173/` (exact, with the trailing slash).
6. Copy the client ID (`….apps.googleusercontent.com`) into
   `WEB_CLIENT` in src/drive.js. It isn't a secret; it can go in the repo
   or in chat.
7. Later, for the Windows app: a **Desktop app** client, its ID and
   "secret" into `DESKTOP_CLIENT` / `DESKTOP_SECRET` (Google says that
   secret can't be kept in an app and isn't treated as one), plus the
   Tauri loopback commands LifeLog has (src-tauri/src/oauth.rs). The
   Android app needs keel's Drive plugin and an Android client with the
   APK's signing key. Neither is needed for the web app.

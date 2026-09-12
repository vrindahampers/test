# 💬 Chatly — Social Chat Web App

A WhatsApp/Instagram-style social chat app built with **HTML + CSS + vanilla JS + Firebase** (Auth, Realtime Database, Storage). No backend server needed.

## Files

| File | Purpose |
|---|---|
| `index.html` / `style.css` / `script.js` | The user app (auth, profile, social, chat, notifications) |
| `admin.html` / `admin.js` | The separate Admin Panel |
| `firebase-config.js` | Firebase configuration (paste your keys here) |
| `database.rules.json` | Realtime Database security rules |

## 1. Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Project settings → Your apps → Web app (`</>`)** → register it and copy the `firebaseConfig`.
3. Paste it into **`firebase-config.js`** (replace the placeholder values). Never put service-account/private keys here.
4. **Authentication → Sign-in method** → enable:
   - **Email/Password**
   - **Email link (passwordless, passwordless)** — it is listed under Email/Password providers; enable it.
   - Add your domain(s) under **Authentication → Settings → Authorized domains** (`localhost` works by default; add `yourusername.github.io` for GitHub Pages).
5. **Realtime Database → Create database** (start in locked/test mode), then open the **Rules** tab and paste the contents of **`database.rules.json`** → Publish.
6. **Storage → Get started** (default rules are fine for learning; for production add size/type rules).
7. Enable the **Email/Password** templates in **Authentication → Templates** (used for password reset and email-link sign-in).

## 2. Default user avatar

The app uses generated avatars from `ui-avatars.com`. If you prefer fully local assets, create an `assets/default-avatar.png` and change `DEFAULT_AVATAR` in `script.js`.

## 3. Run

Just open `index.html` via a local server (email-link login needs `http://`, not `file://`):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Admin panel: open `admin.html`.

## 4. Create the first admin account (securely)

There is no secret URL or frontend password — admin rights live **in the database and are enforced by security rules**:

1. Sign up normally in `index.html`.
2. In the Firebase console → **Realtime Database**, set:
   ```
   users/<YOUR_UID>/role = "admin"
   ```
   (Find your UID in **Authentication → Users**.)
3. Log in at `admin.html`. The console is the only place that can grant `role: "admin"` — the security rules make `role` and `status` writable **only by existing admins**, so users can never promote themselves.

For stronger guarantees you can also set a **custom claim** `admin: true` with the Admin SDK (requires a trusted environment/Cloud Function) and check it in rules with `auth.token.admin == true`.

## 5. Deploy to GitHub Pages

1. Push the project to a GitHub repository.
2. **Settings → Pages → Deploy from branch → main → / (root)**.
3. Add `https://<user>.github.io/<repo>/` to **Firebase → Authentication → Authorized domains**.
4. In `firebase-config.js` the `authDomain` can stay as the Firebase domain; email-link login uses `location.origin`, so it will work on the Pages URL.

## 6. Security model (summary)

- **Authentication**: Firebase Auth only. Passwords are never stored in the database.
- **Username login**: `usernames/{lowercaseUsername} → uid` mapping; the app resolves the email and calls Firebase Auth. Rules require the mapping value to equal the writer's own UID and reject overwriting an existing name (no duplicates).
- **Admin**: `users/{uid}/role === "admin"`; rules restrict reading `reports`, `adminLogs` and writing `status`/`role` to admins only. A normal user who opens `admin.html` is denied by the rules, not by JavaScript.
- **Account status**: `active / suspended / disabled / banned` under `users/{uid}/status`. Rules block protected writes (messages, chats, follows, follows-requests, blocks, username writes) for non-`active` accounts — not just the UI. The app additionally shows a restriction banner and logs out disabled/banned accounts.
- **Chats**: message nodes are keyed `uidA_uidB` (sorted); rules require the caller's UID to be part of the key. Blocked users cannot interact (JS check + you can extend rules with `!root.child('blocks/'+auth.uid+'/'+other).exists()`).
- **Media**: images go to Firebase **Storage**; only the download URL is stored in the database.
- **No open rules**: the final rules never use `".read": true` / `".write": true` at the root.
- **Audit**: every admin action (suspend, ban, message delete, profile edit, user delete, report actions, DB edits/deletes) writes to `adminLogs/{logId}` with admin UID, action, target, timestamp, reason, previous/new value.

## 7. Known limitations (honest notes)

- **Deleting a Firebase Auth account** (as opposed to app data) requires the Admin SDK in a trusted environment (Cloud Function/CLI) — the admin panel removes all application data and marks the audit log; see `firebase auth:delete` CLI or an Admin-SDK Cloud Function.
- **Full token revocation** (force logout) also requires the Admin SDK (`revokeRefreshTokens`); the panel records the action and the app checks `status`, so suspended/banned users are blocked functionally regardless.
- Searching users scans the `usernames` index — fine for learning projects; use a search service at scale.
- Firebase security rules cannot read other users' emails or enforce every possible privacy nuance; sensitive checks are layered (rules + app logic).

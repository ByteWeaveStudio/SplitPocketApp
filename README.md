# SplitPocket

Split shared expenses first, track personal spending second. Create groups,
add an expense, split it equally / by shares / by amounts / by percentage /
item by item, see who owes whom, and settle up with simplified debts — all
offline-first, private by design, and as few taps as possible.

One React codebase ships to web (PWA), iOS, and Android through Capacitor.

## Current state

The app runs on **Firebase alone**. There is no server to deploy: the browser
talks to Firebase Auth and Cloud Firestore directly, and Firestore security
rules are the access boundary.

The Supabase project and the FastAPI service that used to own group writes
have both been removed, and everything they did now runs in the browser:
split arithmetic (`features/groups/split-compute.ts`), balances and debt
simplification (`features/groups/balances.ts`), membership rules, invite
links, the activity feed and settlements. Every feature is live.

One capability did not survive the move. **Adding a member by email is gone** —
it needed an email→account lookup, and `profiles/{uid}` is readable only by its
owner precisely so the client cannot enumerate accounts. The "Add member"
button now opens the invite-link flow, which does the same job.

## Repository layout

| Path                     | What it is                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| `frontend/`              | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + Capacitor |
| `frontend/android/`      | Generated Android platform (Capacitor 8)                           |
| `frontend/ios/`          | Generated iOS platform (Capacitor 8, Swift Package Manager)        |
| `firestore.rules`        | Security rules — the only thing enforcing access                   |
| `firestore.indexes.json` | Composite indexes, one per query the app issues                    |
| `firebase.json`          | Firestore rules/indexes config, plus a Hosting fallback             |
| `.github/workflows/`     | Builds and publishes the web app to GitHub Pages on push to `main` |

> Note: the root `.gitignore` excludes `docs/` and all `*.md` except this
> file, so the local development guide (`docs/DEVELOPMENT.md`) never reaches
> the remote. Anything deploy-critical belongs here.

## Quick start

```sh
cd frontend
npm install
npm run dev   # http://localhost:5173
```

There is no `.env` file and nothing to configure — the Firebase web config is
in `src/services/firebase.ts`. See below for why.

There is no test suite — the project deliberately carries none. `npm run
build` runs `tsc -b` over all of `src`, which is the real gate for a broken
import; `npm run lint` runs oxlint.

## Firebase project setup

Everything below is done once, in the Firebase console, for each environment.

### 1. Web config

Already in the repo, at the top of `frontend/src/services/firebase.ts`. It is
checked in deliberately rather than read from env vars.

None of those values are secret. `apiKey` identifies the project and routes API
calls; it is not a credential, and every Firebase web app ships these in its
bundle — a build-time env var would put the identical strings in `dist/` while
adding a way for a deploy to boot half-configured. Three things do the actual
protecting:

1. **`firestore.rules`** — the access boundary. Nothing else stops a read.
2. **Authorized domains** (Authentication → Settings) — which origins may run
   a sign-in flow.
3. **An HTTP-referrer restriction on the API key** (Google Cloud console →
   APIs & Services → Credentials). This caps quota abuse and billing; it does
   not protect data.

To point the app at a different Firebase project, edit that one object.

### 2. Authentication

Authentication → Sign-in method, enable:

- **Email/Password**
- **Google** (set the project support email)
- **Apple** — needs an Apple Developer account, a Services ID, and a key;
  required by App Store rules if any other third-party sign-in ships on iOS

Authentication → Settings → Authorized domains: add `my.splitpocket.app`
alongside the default Hosting domains. `localhost` must stay listed for local
development and the Capacitor builds.

**Password reset** uses Firebase's own hosted action page by default and needs
no extra setup. To use the in-app page instead, set Authentication →
Templates → Password reset → customise action URL to
`https://<your-domain>/auth/reset-password`; `ResetPasswordPage` reads the
`oobCode` from the query string and handles the rest.

### 3. Firestore

Build → Firestore Database → Create database. Pick a region close to the
users; it cannot be changed later. Start in **production mode** — the rules in
this repo replace whatever the wizard writes.

### 4. Deploy rules and indexes

```sh
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

`.firebaserc` already pins the project, so no `--project` flag is needed.

Indexes take a few minutes to build. Until one is ready its query fails with
a `failed-precondition` error that includes a console link to create it — if
you add a query, add the matching entry to `firestore.indexes.json` rather
than clicking that link, so the repo stays the source of truth.

## Data model

Nine top-level collections, all flat. Subcollections were avoided because the
dashboard and reports read across groups.

| Collection      | Key fields                                                        |
| --------------- | ----------------------------------------------------------------- |
| `profiles`      | one per user, readable only by its owner                          |
| `categories`    | user-created only; id is `{uid}__{slug}`                          |
| `groups`        | `memberIds[]`, `members{}` with denormalized names/avatars        |
| `expenses`      | personal **and** group; `splits[]` and `items[]` nested inline    |
| `settlements`   | `groupId`, `memberIds[]`                                          |
| `groupInvites`  | the document id **is** the bearer token                           |
| `groupActivity` | append-only feed, details denormalized at write time             |
| `comments`      | `expenseId`, `memberIds[]`                                        |
| `splitPresets`  | id is `{groupId}__{slug}`                                         |

Four things are worth knowing before changing any of it:

1. **`memberIds` is on every document** and is what the rules check, so
   authorization costs zero extra reads. For a personal expense it is
   `[ownerId]` — one rule and one query then cover personal and group alike.
2. **Splits live inside the expense document.** Postgres spread them across
   `expense_splits`, `expense_items` and `expense_item_shares` with a deferred
   constraint trigger holding them consistent; nesting them makes every split
   write atomic instead.
3. **The 14 built-in categories are frontend constants**
   (`features/categories/default-categories.ts`), not documents. Their ids are
   stable slugs and must never change — expenses reference them.
4. **Money is integer minor units** everywhere, and `date` is a plain
   `YYYY-MM-DD` string so range filters and month keys keep comparing
   lexicographically.

### Writing a query the rules will accept

Security rules are **not** filters. For a list, Firestore proves from the
query's constraints alone that every document it could match is readable — it
never looks at the documents. A query whose filters don't line up with the rule
is refused outright, with `permission-denied`, even against an empty collection.

Every group-scoped rule here asks `uid in resource.data.memberIds`, so **every
list query against those collections must carry
`where('memberIds', 'array-contains', uid)`** — including ones that already
narrow by `groupId` or `expenseId`, and including the personal-expense queries
(a personal expense has `memberIds == [ownerId]`, so it says the same thing in
the terms the rule is written in).

Add that clause first, then add the matching entry to
`firestore.indexes.json` with `memberIds` as the leading field.

### Known gaps in client-only enforcement

The app is strictly client-side, so some things Postgres guaranteed are now
weaker. All of them are deliberate:

- **Split totals are trusted from the client.** Rules have no loop or sum
  construct, so `sum(splits[].owedMinor) == amountMinor` cannot be checked.
- **Invite `maxUses` is advisory.** Rules cannot atomically
  increment-and-check a counter. Expiry and revocation *are* enforced.
- **Membership changes fan out.** Adding or removing a member rewrites
  `memberIds` on every expense, settlement, comment, activity row and preset in
  that group (`fanOutMemberIds` in `features/groups/group-docs.ts`), in batches
  of 500 with no cross-batch transaction. The group document is always written
  first, because that is what gates discovery: a removed member can no longer
  list the group, so they cannot reach any stragglers by query. Re-running is
  safe — each write is an assignment, not a delta.
- **Multi-document writes are batches, not transactions.** A batch fails or
  succeeds as a unit, which covers "expense plus its activity entry", but
  nothing spans a read and a write. Invite acceptance is the case where that
  shows: the server locked the row, so two people could not spend the last use
  at once. Here they can.
- **Deletes cascade in application code.** Postgres had ON DELETE CASCADE;
  `deleteGroupCascade` spells it out, and deleting an expense removes its
  comments explicitly.

## Deploying the web app

The app is served from **my.splitpocket.app** on GitHub Pages, published by
`.github/workflows/deploy.yml` on every push to `main` that touches
`frontend/`. There is nothing to run by hand, and no secrets or variables to
configure — the Firebase web config is compiled in.

### One-time repo setup

1. Settings → Pages → **Source: GitHub Actions** (not "Deploy from a branch").
2. Settings → Pages → Custom domain: `my.splitpocket.app`, then tick **Enforce
   HTTPS** once the certificate provisions.
3. At your DNS provider, point `my.splitpocket.app` at GitHub Pages with a
   CNAME record to `byteweavestudio.github.io`.
4. Firebase console → Authentication → Settings → Authorized domains: add
   `my.splitpocket.app`. Without it every sign-in fails with
   `auth/unauthorized-domain`.
5. Google Cloud console → Credentials: restrict the API key to the
   `my.splitpocket.app` HTTP referrer.

`frontend/public/CNAME` holds the domain so it survives every publish — Pages
otherwise forgets a custom domain each time the Action replaces the site.

### Two things the build does for Pages specifically

- **`404.html`.** Pages has no rewrite rules, so a cold load of `/groups/abc`
  would be a 404. Pages *does* serve `404.html` for unmatched paths, so the
  `spaFallback` plugin in `vite.config.ts` copies `index.html` to that name
  after the build and react-router takes over from there. It is excluded from
  the service worker precache — the SW should hold one copy, not two.
- **`.nojekyll`.** Stops Pages running the build output through Jekyll, which
  would drop any file or directory beginning with an underscore.

The custom domain is also what keeps this simple: a project page would serve at
`/SplitPocketApp/` and need a Vite `base` plus a router `basename`, which in
turn would break the Capacitor builds. At a domain root, `base` stays `/`.

### OAuth and the auth handler

Firebase's Google and Apple flows bounce through `/__/auth/handler`, and
GitHub Pages cannot serve that path. It therefore stays on
`splitpocket-806a1.firebaseapp.com`, a different *site* from the app — and
browsers partition storage by site, which makes `signInWithRedirect`
unreliable and `signInWithPopup` fragile. Email/password is unaffected.

If sign-in misbehaves in Safari or a locked-down Chrome, the fix does not
require moving off Pages:

1. Attach `auth.splitpocket.app` to Firebase Hosting as a custom domain and
   deploy once (`firebase deploy --only hosting`). Hosting serves the handler
   on any domain it answers for.
2. Add `auth.splitpocket.app` to authorized domains.
3. Change `authDomain` in `frontend/src/services/firebase.ts` to
   `auth.splitpocket.app`.

Same registrable domain as the app, so the browser treats it as first-party.
The `hosting` block in `firebase.json` is kept for exactly this — and as the
fallback if Pages turns out not to be worth the workarounds.

## Android (before iOS: cheaper, faster review)

Current state: `versionCode 1` / `versionName "1.0"`, applicationId
`com.splitpocket.app`, minSdk 24 / target 36, Gradle 8.14.3, **no release
signing configured**, stock Capacitor launcher icons.

1. **Toolchain:** Android Studio (SDK + build tools) and JDK 21 (Capacitor 8
   requirement; Android Studio's bundled runtime covers it). Gradle comes from
   the project's `gradlew`.
2. **Icons/splash:** generate via `@capacitor/assets` to replace the stock
   template assets — stores flag default icons.
3. **Upload keystore** (one-time):

   ```sh
   keytool -genkey -v -keystore splitpocket-upload.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```

   Wire it into `android/app/build.gradle` via a `signingConfigs` block
   reading from a git-ignored `key.properties`. **Back the keystore up
   somewhere safe** — losing an upload key is painful even with Play App
   Signing.
4. **Build:** `npm run build` (production env vars!) → `npx cap sync android`
   → `./gradlew bundleRelease`. Play requires the `.aab` format. Bump
   `versionCode`/`versionName` in `android/app/build.gradle` on every upload.
5. **Play Console:** account ($25 one-time), enroll in Play App Signing, store
   listing (icon, screenshots, feature graphic), a hosted **privacy policy
   URL** (mandatory — one does not exist yet), the data-safety form, and the
   content-rating questionnaire.
6. **Gotcha:** new *personal* developer accounts must run a closed test with
   12+ testers for 14 continuous days before production access — start that
   track immediately; organization accounts skip it.

## iOS

Current state: bundle id `com.splitpocket.app`, `MARKETING_VERSION 1.0`, iOS
15.0 deployment target, automatic signing with **no development team set**,
Swift Package Manager (no CocoaPods needed).

1. Apple Developer Program ($99/year), then select the team in Xcode (Signing
   & Capabilities) — nothing builds for device without it.
2. Icons/splash from the same `@capacitor/assets` run.
3. **Build:** `npm run build` → `npx cap sync ios` → `npx cap open ios` →
   Product → Archive → distribute via App Store Connect. TestFlight first,
   then submit. Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` per
   upload.
4. The listing needs the privacy policy URL plus privacy nutrition labels
   (the app collects account data via Firebase Auth).
5. **Known limitation:** native OAuth inside the Capacitor shells still needs
   in-app-browser + deep-link return work. `signInWithOAuth` already falls
   back from popup to redirect, which is the right shape, but it has not been
   exercised on device. Email/password works everywhere. App Store rule: if
   any third-party sign-in ships on iOS, Sign in with Apple must too.

## Launch checklist

- [ ] Firestore rules and indexes deployed; indexes finished building
- [ ] Pages source set to GitHub Actions; `my.splitpocket.app` set as the
      custom domain with Enforce HTTPS on
- [ ] DNS CNAME points at `byteweavestudio.github.io`
- [ ] A hard reload of `my.splitpocket.app/groups/x` serves the app, not a 404
- [ ] `my.splitpocket.app` listed under authorized domains along with
      `localhost`
- [ ] Email/Password, Google and Apple sign-in enabled
- [ ] Google sign-in tested in Safari specifically — it is the strictest about
      cross-site storage, and the auth handler is cross-site here
- [ ] API key restricted to the `my.splitpocket.app` referrer
- [ ] Password reset round-trips against production
- [ ] A signed-out browser can read nothing — check in the Rules Playground
- [ ] Offline reload renders the shell and cached data; an expense added
      offline appears at once and syncs on reconnect
- [ ] Real PWA icons (192/512 + maskable + apple-touch-icon) shipped
- [ ] Privacy policy written and hosted (blocks both store listings)
- [ ] Android: signed `.aab` uploaded, closed-test clock started
- [ ] iOS: archive uploaded to TestFlight
- [ ] Upload keystore backed up outside the repo

## Rolling back

The site is whatever `main` last built, so a revert plus a push republishes.
Actions → Deploy web app to GitHub Pages → Re-run on an older successful run
also works and is faster.

Rules and indexes are separate and do not version themselves — the repo is the
source of truth, so roll those back by checking out the previous
`firestore.rules` and redeploying.

Rules are the one deploy that can lock every user out instantly. Test a rules
change in the Rules Playground before shipping it.

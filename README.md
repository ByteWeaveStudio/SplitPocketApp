# SplitPocket

Split shared expenses first, track personal spending second. Create groups,
add an expense, split it equally / by shares / by amounts / by percentage /
item by item, see who owes whom, and settle up with simplified debts — all
offline-first, private by design, and as few taps as possible.

One React codebase ships to web (PWA), iOS, and Android through Capacitor.

## Repository layout

| Path                   | What it is                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `frontend/`            | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + Capacitor  |
| `frontend/android/`    | Generated Android platform (Capacitor 8)                            |
| `frontend/ios/`        | Generated iOS platform (Capacitor 8, Swift Package Manager)         |
| `backend/`             | Python 3.14 + FastAPI (uv-managed) — splits, balances, settlements  |
| `supabase/migrations/` | SQL migrations (Supabase CLI naming, custom Python runner)          |

Supabase provides Postgres, Auth, Realtime, and RLS. The frontend talks to
Supabase directly for auth and realtime; multi-row business logic (splits,
balances, settlements, invites) goes through FastAPI, which verifies
Supabase JWTs and connects with the service-role key.

> Note: the root `.gitignore` excludes `docs/` and all `*.md` except this
> file, so the local development guide (`docs/DEVELOPMENT.md`) never reaches
> the remote. Anything deploy-critical belongs here.

## Quick start

```sh
# Frontend — http://localhost:5173
cd frontend
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev

# Backend — http://localhost:8000 (docs at /docs in development)
cd backend
uv sync
cp .env.example .env         # fill in Supabase values, ENVIRONMENT=development
uv run uvicorn app.main:app --reload --port 8000

# Database migrations (uses DATABASE_URL from backend/.env)
cd backend
uv run python -m app.db.migrate            # apply pending
uv run python -m app.db.migrate --status   # list applied/pending

# Tests — neither suite needs a network or a database
cd backend && uv run pytest
cd frontend && npm test
```

---

# Production deployment plan

**Topology:** one Linux box, no containers. nginx is the public edge: it
terminates TLS, serves the built frontend from disk, and reverse-proxies
`/api/` to a uvicorn process on `127.0.0.1:8000` managed by systemd.
Postgres, Auth and Realtime stay on hosted Supabase — the browser talks to
Supabase directly, so that traffic never crosses this machine.

```
browser ──► nginx :443 ─┬─ /       → /srv/splitpocket/app/frontend/dist  (static + SPA fallback)
                        └─ /api/   → 127.0.0.1:8000  (uvicorn → FastAPI)
browser ──► <project-ref>.supabase.co                (auth, realtime, direct reads)
```

**One origin, and why it matters:** the web app and the API share a single
origin, so `/api/v1/...` requests are same-origin — no CORS preflight, no
scheme mismatch. CORS still governs the native Capacitor shells, which are
cross-origin by construction. uvicorn binds loopback only; nothing but nginx
can reach it.

**The constraint that orders everything:** the native apps bundle the built
`dist/`, and `VITE_API_URL` / `VITE_SUPABASE_*` are baked in at build time.
So: pick the domain, create the production Supabase project, stand up the
server and backend, build and serve the web frontend, then CI, then the
stores. Store builds are last because they freeze whatever URLs they were
built with. (Single-origin does relax this a little — `VITE_API_URL` is just
the site origin, known the moment the domain is chosen.)

**Assumed host:** Ubuntu 24.04 LTS, ≥2 GB RAM (the Vite build is the
memory-hungry step — on 1 GB add swap or build elsewhere and copy `dist/`
over), a domain with A/AAAA records pointing at it.

**What exists today:** a clean test suite on both sides, eight idempotent
SQL migrations, and generated native projects. **What doesn't exist yet:**
any systemd unit, nginx config, CI workflow, release signing, branded app
icons, or a privacy policy — those are the work below.

## Phase 1 — Production Supabase project

1. Create a fresh Supabase project for production (never reuse the dev
   project; its seeded test accounts are not customer data).
2. Apply migrations from a machine with the production `DATABASE_URL` in
   `backend/.env`:

   ```sh
   cd backend
   uv run python -m app.db.migrate            # applies all 8
   uv run python -m app.db.migrate --status   # expect: 8 applied, 0 pending
   ```

   `DATABASE_URL` note: Supabase's "direct connection" host is IPv6-only on
   some plans. On IPv4-only machines use the **Session Pooler** string
   (dashboard → Connect → Connection String):
   `postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres`.
3. Verify realtime wiring. The migrations add nine tables to the
   `supabase_realtime` publication, but each `ALTER` is guarded by an
   existence check on the publication — if it was missing when migrations
   ran, they were *silently skipped*. Check:

   ```sql
   select tablename from pg_publication_tables
   where pubname = 'supabase_realtime';
   -- expect 9 rows: groups, group_members, expenses, expense_splits,
   -- settlements, expense_items, expense_item_shares, group_activity,
   -- expense_comments
   ```
4. Auth configuration (dashboard → Authentication → URL Configuration):
   - **Site URL**: the production web origin.
   - **Redirect URLs**: add `<origin>/auth/callback` (OAuth) and
     `<origin>/auth/reset-password` (password reset) — the app builds both
     from `window.location.origin`.
5. OAuth providers (both code-complete in the app, off until enabled):
   - **Google** (free): Google Cloud Console → Credentials → OAuth client
     ID (Web application) with redirect URI
     `https://<project-ref>.supabase.co/auth/v1/callback`; paste client ID +
     secret into Supabase → Authentication → Providers → Google.
   - **Apple**: needs an Apple Developer Program membership; configure the
     Services ID / key per the provider page. Can wait for the iOS phase.
6. Configure custom SMTP (dashboard → Authentication → Emails). The
   built-in sender is heavily rate-limited and unsuitable for real
   signup/reset traffic.
7. Confirm the three `auth.users` triggers exist (created by migrations):
   `on_auth_user_created`, `on_auth_user_email_updated`,
   `on_auth_user_deleted`. Without the first, signups get no profile row.

## Phase 2 — Server prep and the backend API

### 2.1 Machine prep

```sh
sudo apt update && sudo apt install -y nginx git curl

# uv, system-wide so systemd and every shell see the same binary.
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh

# Node 22 — only needed to build the frontend on this box (Vite 8 wants
# Node 20.19+ / 22.12+). Skip if you build elsewhere and copy dist/ over.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# Service account that owns the code and runs uvicorn. No login shell.
sudo useradd --system --home /srv/splitpocket --shell /usr/sbin/nologin splitpocket

sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Python 3.14 is required by `pyproject.toml`; don't hunt for a distro
package — `uv sync` reads `backend/.python-version` and downloads a managed
CPython 3.14 itself.

### 2.2 Code layout

Clone the whole repo. `backend/` and `supabase/` **must stay siblings**: the
migration runner resolves the migrations directory from the repo root — i.e.
`../supabase/migrations` relative to `backend/` — not from the CWD.

```sh
sudo mkdir -p /srv/splitpocket && sudo chown splitpocket:splitpocket /srv/splitpocket
sudo -u splitpocket -H git clone <repo-url> /srv/splitpocket/app

cd /srv/splitpocket/app/backend
sudo -u splitpocket -H uv sync --frozen --no-dev   # creates .venv/, fetches CPython 3.14
```

Everything under `/srv/splitpocket` is owned by `splitpocket`, so run git,
uv and npm as that user. **The `-H` is not decoration:** without it `sudo`
keeps your `HOME`, and uv's managed CPython, uv's cache and npm's cache all
land in your home directory as `splitpocket`-owned files — which then break
the next deploy run as anyone else. Running these as yourself instead is the
other version of the same mistake: git reports "detected dubious ownership"
and root-owned files pile up in `node_modules/` and `.venv/`.

```
/srv/splitpocket/app/
├── backend/.env                     # 0600, owned by splitpocket
├── backend/.venv/bin/uvicorn        # what systemd execs
├── supabase/migrations/             # sibling of backend/ — required
└── frontend/dist/                   # nginx root (Phase 3)
```

Private repo: give the service user a read-only deploy key
(`/srv/splitpocket/.ssh/id_ed25519`, mode 600, owned by `splitpocket`) and
register the public half on the repo. Deploys are `git pull`, so the key
needs read access only.

### 2.3 Configuration

Settings come from `backend/.env` — `app/core/config.py` anchors that path
to the backend package, so it loads regardless of systemd's working
directory, and the migration CLI reads the same file.

```sh
sudo -u splitpocket cp /srv/splitpocket/app/backend/.env.example /srv/splitpocket/app/backend/.env
sudo -u splitpocket chmod 600 /srv/splitpocket/app/backend/.env
sudo -u splitpocket nano /srv/splitpocket/app/backend/.env
```

| Variable              | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `ENVIRONMENT`         | `production` — already the default; only the exact string `development` re-enables `/docs`, `/redoc`, `/openapi.json` |
| `SUPABASE_URL`        | `https://<project-ref>.supabase.co` — also pins the JWT issuer and JWKS URL |
| `SUPABASE_SECRET_KEY` | Secret API key (`sb_secret_...`) — bypasses RLS, server-side only          |
| `SUPABASE_JWT_SECRET` | **Leave unset.** Only legacy projects signing HS256 JWTs need it; current projects verify via JWKS |
| `DATABASE_URL`        | Session Pooler string (see Phase 1). Connects as `postgres`, which bypasses RLS — the API scopes every query itself |
| `CORS_ORIGINS`        | Optional. The web app is same-origin, so it needs no CORS at all; the default list already covers the Capacitor schemes. **Setting it replaces the entire default list** — if you set it, the native apps break unless you re-list `["capacitor://localhost","https://localhost"]`. Narrowing to exactly those two (dropping the localhost dev origins) is the tidy production value |

### 2.4 systemd unit

```ini
# /etc/systemd/system/splitpocket-api.service
[Unit]
Description=SplitPocket API (uvicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=splitpocket
Group=splitpocket
WorkingDirectory=/srv/splitpocket/app/backend
ExecStart=/srv/splitpocket/app/backend/.venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 --port 8000 \
    --proxy-headers --forwarded-allow-ips=127.0.0.1 \
    --workers 2
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now splitpocket-api
sudo journalctl -u splitpocket-api -f
```

Notes on that unit:

- Exec the venv's `uvicorn` directly rather than `uv run` — no cache dir to
  punch through `ProtectSystem=strict`, and no dependency resolution on the
  hot path of a restart. `WorkingDirectory` must be `backend/` so uvicorn
  can import `app.main`.
- `--host 127.0.0.1`: loopback only. nginx is the only way in.
- No `--reload`, ever, in production.
- `--proxy-headers` (uvicorn's default, stated explicitly here) makes
  `X-Forwarded-Proto: https` from nginx visible to the app;
  `--forwarded-allow-ips` keeps those headers trusted only from nginx.
- The app writes nothing to disk, so `ProtectSystem=strict` needs no
  `ReadWritePaths`.
- **Worker count is a database budget.** Each worker process runs its own
  lifespan and opens its own pool — min 1, max 5 connections, hardcoded in
  `app/db/pool.py`. Two workers means up to 10 pooled connections plus
  whatever migrations use. Size against the connection limit on the
  Supabase pooler, not against CPU count.

### 2.5 Verify (on the box, before nginx exists)

```sh
curl -fsS http://127.0.0.1:8000/api/v1/health
# {"status":"ok","environment":"production","supabase_configured":true}

curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/docs   # expect 404
```

- `/api/v1/health` never touches the database. It is a liveness check only
  and returns `ok` even with a wrong `DATABASE_URL` — so also hit an
  authenticated DB-backed endpoint once (`GET /api/v1/me` with a real
  session token) before calling this phase done.
- There is no fail-fast startup validation: the app boots "healthy" with
  missing Supabase config and only errors at request time. The manual check
  above is the real gate.
- Once nginx is in front, `/docs` is unreachable from the internet by
  construction — nginx only proxies `/api/`, so an external `GET /docs`
  returns the SPA shell, not Swagger. The 404 check above is the one that
  actually proves docs are off, and it only works from the box.

## Phase 3 — Web frontend and nginx

1. **Real PWA icons first** (pending since Milestone 7): generate 192×192
   and 512×512 PNGs plus a maskable icon from one source image, list them
   in the `VitePWA` manifest in `frontend/vite.config.ts`, and add an
   `apple-touch-icon` link to `index.html`. Also extend the Workbox
   `globPatterns` (currently `js,css,html,svg,woff2`) with `png` so the new
   icons are precached. `npx @capacitor/assets generate` can produce the
   full icon/splash set for all three platforms from the same source image
   (the package is not installed yet).
2. Build with production values — all three are baked in at build time.
   Put them in `frontend/.env.production.local` on the box (git-ignored;
   `npm run build` loads `.env.production*` automatically):

   | Variable                        | Value                                          |
   | ------------------------------- | ---------------------------------------------- |
   | `VITE_SUPABASE_URL`             | `https://<project-ref>.supabase.co`            |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_...`)         |
   | `VITE_API_URL`                  | `https://<your-domain>` — the site origin, no `/api` suffix: call sites already pass `/api/v1/...` paths. **If unset it silently defaults to `http://localhost:8000`** with no build-time error, so double-check this one |

   `VITE_API_URL` must be an **absolute** URL. `src/lib/env.ts` validates it
   with `z.url()`, so a bare `/api` fails validation and the app throws on
   first import rather than falling back to same-origin. The native shells
   need an absolute URL anyway.

   ```sh
   cd /srv/splitpocket/app/frontend
   sudo -u splitpocket -H npm ci
   sudo -u splitpocket -H npm run build     # tsc -b && vite build → dist/
   ```

3. **nginx.** The app uses `createBrowserRouter`, so every non-file route
   must return `/index.html` (the service worker's `navigateFallback` only
   covers repeat visits after installation — not a first load on a deep
   link). Write the site file, then let certbot add TLS:

   ```nginx
   # /etc/nginx/sites-available/splitpocket
   server {
       listen 80;
       listen [::]:80;
       server_name splitpocket.example.com;

       root /srv/splitpocket/app/frontend/dist;
       index index.html;
       server_tokens off;

       gzip on;
       gzip_min_length 1024;
       gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

       add_header X-Content-Type-Options nosniff always;
       add_header Referrer-Policy strict-origin-when-cross-origin always;

       # API → uvicorn. No URI after the port, so the /api/ prefix is passed
       # through unchanged — FastAPI mounts its router at /api/v1.
       location /api/ {
           proxy_pass http://127.0.0.1:8000;
           proxy_http_version 1.1;
           proxy_set_header Host              $host;
           proxy_set_header X-Real-IP         $remote_addr;
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 60s;
       }

       # Hashed filenames — safe to cache forever.
       location /assets/ {
           expires 1y;
           add_header Cache-Control "public, immutable";
           try_files $uri =404;
       }
       location ~* ^/workbox-.*\.js$ {
           expires 1y;
           add_header Cache-Control "public, immutable";
       }

       # Never cache the entry point or the service worker: autoUpdate only
       # works if the browser can see a new sw.js, and a cached index.html
       # points at asset hashes that no longer exist after a deploy.
       location = /index.html          { add_header Cache-Control "no-cache"; }
       location = /sw.js               { add_header Cache-Control "no-cache"; }
       location = /registerSW.js       { add_header Cache-Control "no-cache"; }
       location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }

       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```

   ```sh
   sudo ln -s /etc/nginx/sites-available/splitpocket /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx

   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d splitpocket.example.com   # adds TLS + the :80 → :443 redirect
   ```

   nginx must be able to traverse `/srv/splitpocket` — `chmod o+x` the path
   components if the clone came out group-private. Certbot writes
   `listen 443 ssl;`; on nginx ≥ 1.25 add `http2 on;` beside it, on 1.24
   (what 24.04 ships) it's `listen 443 ssl http2;`. Add HSTS
   (`add_header Strict-Transport-Security "max-age=31536000;
   includeSubDomains" always;`) once you're sure HTTPS is stable — it is
   hard to walk back. Renewal is automatic via certbot's systemd timer;
   confirm with `systemctl list-timers | grep certbot`.

4. Add the origin to Supabase's redirect URLs (Phase 1.4) if it wasn't
   final then. The web app needs no `CORS_ORIGINS` entry — it is
   same-origin; see the Phase 2.3 table before touching that variable.

**Verify:**

```sh
curl -fsS https://splitpocket.example.com/api/v1/health   # through nginx now
curl -sI https://splitpocket.example.com/groups | head -1 # 200, not 404 (SPA fallback)
curl -sI https://splitpocket.example.com/sw.js | grep -i cache-control
```

Then in a browser: sign up, add an expense, and confirm the Network tab
shows **no** CORS preflight (`OPTIONS`) against `/api/` — a preflight means
the build baked in a cross-origin `VITE_API_URL`. Then the offline drill —
load the app, go offline (airplane mode), reload: the shell and cached data
must still render. Then Lighthouse's PWA install check, and a
password-reset email round trip against the production origin.

## Phase 4 — CI (GitHub Actions)

The repo lives on GitHub, so Actions is the natural choice. Neither test
suite touches the network or a database, so **no secrets are needed for
CI** — that's by design and keeps the workflow trivial:

- **Backend job:** `uv sync` → `uv run ruff check .` → `uv run pytest`
  (needs Python 3.14).
- **Frontend job:** `npm ci` → `npm run lint` → `npm test` →
  `npm run build` (the build also type-checks via `tsc -b`).

Wire both to push + pull request. Deploy stays manual for now — the update
runbook above is four commands over SSH. Automating it later means an
Actions job that SSHes in (deploy key + `SSH_PRIVATE_KEY` secret) and runs
that same script; `SUPABASE_SECRET_KEY` and `DATABASE_URL` never need to
leave the box, since the migration step runs there against `backend/.env`.
If CI ever does need them, use repo environment secrets, never files.

## Phase 5 — Android (before iOS: cheaper, faster review)

Current state: `versionCode 1` / `versionName "1.0"`, applicationId
`com.splitpocket.app`, minSdk 24 / target 36, Gradle 8.14.3, **no release
signing configured**, stock Capacitor launcher icons.

1. **Toolchain:** Android Studio (SDK + build tools) and JDK 21 (Capacitor
   8 requirement; Android Studio's bundled runtime covers it). Gradle comes
   from the project's `gradlew`.
2. **Icons/splash:** generate via `@capacitor/assets` (Phase 3.1) to
   replace the stock template assets — stores flag default icons.
3. **Upload keystore** (one-time):

   ```sh
   keytool -genkey -v -keystore splitpocket-upload.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```

   Wire it into `android/app/build.gradle` via a `signingConfigs` block
   reading from a git-ignored `key.properties`. **Back the keystore up
   somewhere safe** — losing an upload key is painful even with Play App
   Signing.
4. **Build:** `npm run build` (production env vars!) → `npx cap sync
   android` → `./gradlew bundleRelease` (or Android Studio → Generate
   Signed App Bundle). Play requires the `.aab` format. Bump
   `versionCode`/`versionName` in `android/app/build.gradle` on every
   upload.
5. **Play Console:** account ($25 one-time), enroll in Play App Signing
   (Google holds the final key; yours is the upload key), store listing
   (icon, screenshots, feature graphic), a hosted **privacy policy URL**
   (mandatory — one does not exist yet and must be written and hosted), the
   data-safety form, and the content-rating questionnaire.
6. **Gotcha:** new *personal* developer accounts must run a closed test
   with 12+ testers for 14 continuous days before production access —
   start that track immediately; organization accounts skip it.

## Phase 6 — iOS

Current state: bundle id `com.splitpocket.app`, `MARKETING_VERSION 1.0`,
iOS 15.0 deployment target, automatic signing with **no development team
set**, Swift Package Manager (no CocoaPods needed).

1. Apple Developer Program ($99/year), then select the team in Xcode
   (Signing & Capabilities) — nothing builds for device without it.
2. Icons/splash from the same `@capacitor/assets` run.
3. **Build:** `npm run build` (production env) → `npx cap sync ios` →
   `npx cap open ios` → Product → Archive → distribute via App Store
   Connect. TestFlight first, then submit for review. Bump
   `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` per upload.
4. App Store listing needs the same privacy policy URL plus the privacy
   nutrition labels (the app collects account data via Supabase Auth).
5. **Known limitation:** native OAuth (Google/Apple buttons inside the
   Capacitor shells) still needs in-app-browser + deep-link return work —
   web OAuth works, email/password works everywhere. Either ship v1 native
   with email/password only, or do that work first. Note App Store rule:
   if any third-party sign-in is offered in the iOS app, Sign in with
   Apple must be too.

## Launch checklist

- [ ] Production Supabase project migrated (`8 applied, 0 pending`) and
      realtime publication shows 9 tables
- [ ] Auth Site URL + both redirect URLs set; SMTP configured; password
      reset round-trips against production
- [ ] `splitpocket-api.service` enabled and `Restart=always`; survives
      `sudo reboot`
- [ ] Backend live: `/api/v1/health` says `production` +
      `supabase_configured: true`; `/docs` is 404 **on the box**; authed
      `/api/v1/me` returns a profile
- [ ] uvicorn answers on `127.0.0.1` only — `curl http://<public-ip>:8000`
      from elsewhere must fail; ufw allows 22/80/443 only
- [ ] If `CORS_ORIGINS` is set at all, it lists both Capacitor schemes
- [ ] nginx: TLS via certbot with auto-renewal (`systemctl list-timers |
      grep certbot`), SPA fallback so a cold deep link into `/groups/<id>`
      loads, `sw.js` + `index.html` served `no-cache`
- [ ] Web app makes no CORS preflight against `/api/`; offline reload
      renders shell + cached data
- [ ] Real PWA icons (192/512 + maskable + apple-touch-icon) shipped
- [ ] CI green on both suites
- [ ] Privacy policy written and hosted (blocks both store listings)
- [ ] Android: signed `.aab` uploaded, closed-test clock started (personal
      account: 12 testers × 14 days)
- [ ] iOS: archive uploaded to TestFlight
- [ ] Upload keystore backed up outside the repo

## Deploying an update

```sh
cd /srv/splitpocket/app
sudo -u splitpocket -H git pull

# Backend
cd backend
sudo -u splitpocket -H uv sync --frozen --no-dev
sudo -u splitpocket -H uv run python -m app.db.migrate   # only when migrations changed
sudo systemctl restart splitpocket-api

# Frontend — build beside the live dir, then swap, so the window where
# index.html and the hashed assets disagree is a rename rather than a build.
cd ../frontend
sudo -u splitpocket -H npm ci
sudo -u splitpocket -H npm run build -- --outDir dist.new --emptyOutDir
sudo -u splitpocket -H rm -rf dist.old && sudo -u splitpocket -H mv dist dist.old
sudo -u splitpocket -H mv dist.new dist
```

No nginx reload is needed — `root` is a real directory, not a symlink, so
the swapped files are picked up on the next request. `systemctl restart`
drops in-flight requests; fine at this app's traffic. Zero-downtime would
need a second uvicorn on another port and an nginx upstream switch, which
isn't worth it yet.

Migrations run **before** the restart when they are additive (new tables,
new columns), and the frontend swap goes last so no client sees a UI that
expects an endpoint the running backend doesn't have yet.

## Rollbacks and migration policy

- Web: the previous build stays on disk as `frontend/dist.old`, so a
  rollback is a rename, no rebuild:
  `mv dist dist.bad && mv dist.old dist`.
- Backend: the API is stateless — `git checkout <previous-sha>`,
  `uv sync --frozen --no-dev`, `sudo systemctl restart splitpocket-api`.
  Keep the SHA of the last known-good deploy somewhere you can read
  without the box.
- nginx: `sudo nginx -t` before every reload. A bad config that passes
  `-t` but breaks the site rolls back by restoring
  `/etc/nginx/sites-available/splitpocket` — keep that file in a
  configuration repo or at least back it up, since it is the one piece of
  production state that lives outside this repo.
- Database: migrations are forward-only. Never edit an applied migration —
  add a new file. History lives in
  `supabase_migrations.schema_migrations`, the same table the Supabase CLI
  uses, so adopting `supabase db push` later needs no re-baselining.

## Post-launch hardening backlog

Deliberately not launch blockers, in rough priority order:

- Fail-fast config validation in production (refuse to boot with missing
  `SUPABASE_URL` / `DATABASE_URL`) and a readiness probe that actually
  checks the DB pool.
- Error tracking (e.g. Sentry) and structured logging on the backend;
  currently there is neither.
- Make DB pool sizing env-configurable (`min_size`/`max_size` are
  hardcoded at 1/5 per worker) — it's the one knob that decides how many
  uvicorn workers this box can afford.
- Deploy automation: deploy-on-main over SSH instead of a hand-run
  runbook, and move the Vite build off the production box (build in CI,
  ship the `dist/` tarball) so a deploy can't OOM the API.
- Release directories (`releases/<sha>` + a `current` symlink) instead of
  building in place, for an atomic swap and a one-command rollback.
- `limit_req` on `location /api/` and a Content-Security-Policy header;
  neither exists today. `unattended-upgrades` + `fail2ban` on the host.
- Machine-level monitoring: this is now a single box, so disk, memory and
  "did nginx come back after reboot" are on you — an uptime check hitting
  `/api/v1/health` from outside is the cheapest version of it.
- Store release automation (Fastlane or Actions lanes) and a version-bump
  convention (`package.json` still says 0.0.0).
- Account-deletion flow (App Store expects one for apps with accounts;
  the DB side — profile tombstoning — already exists).
- `minifyEnabled true` + resource shrinking for Android release builds.

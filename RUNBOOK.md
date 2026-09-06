# Birhan — Operations Runbook

What to do when something breaks, ships, or needs rolling back. Keep this short
and current.

Everything runs on **one VPS** — there is no Supabase, no Cloudflare, no CI/CD,
no staging, and no git remote. Deploys are run **by hand from a dev machine**
over SSH. Surfaces:

- **Mobile app** — Expo (SDK 57) → release APK. Distributed as a download, not a
  store: APKs live at `birhan.online/downloads/`, and the app self-updates by
  polling a manifest (below).
- **Backend API** — a Node/Hono service (`birhan-api.service`, systemd) on the
  VPS, reverse-proxied by nginx at `api.birhan.online`.
- **Admin console** — a static Vite SPA under `/var/www/admin.birhan.online`,
  behind nginx **HTTP basic auth**.
- **Marketing site** — static files under `/var/www/birhan.online` (the
  `website/` dir), including `/downloads/*.apk`.

**The one host:** `root@191.215.40.44`, key `~/.ssh/birhan_deploy`. The key
works **only as `root`** — `ssh birhan@…` is refused. Postgres and MinIO run as
docker containers (`birhan-backend-postgres-1`, `birhan-backend-minio-1`); the
API itself does **not** — it is a plain systemd process.

---

## When something is down — first checks, in order

1. **Backend?** `curl https://api.birhan.online/api/v1/health` → expect `200`.
   - Not 200 → `ssh root@191.215.40.44 'systemctl status birhan-api.service'`
     and `journalctl -u birhan-api.service -n 50`. It restarts on crash
     (`Restart=always`) and takes **~3s** to start listening — don't judge a
     restart before then.
   - 200 but writes fail → check the docker DB: `docker ps` (is
     `birhan-backend-postgres-1` healthy?), and `journalctl` for DB connection
     errors.
2. **Admin console only?** It returns **401 for everyone** (basic auth) — that is
   normal, not an outage. To check a deploy landed, look at the files on disk
   (`ssh root@… 'ls /var/www/admin.birhan.online/assets/'`), not the public URL.
   A blank page after login usually means the bundle points at the wrong API —
   rebuilt without `VITE_API_URL`.
3. **Mobile app only?** The offline Bible always works (bundled). If sign-in or
   announcements fail while health is 200, suspect the API or a stale
   `CORS_ORIGINS`. A bad build is fixed by shipping the next versionCode, not by
   pulling the old one — installed apps keep working.
4. **What changed?** There is no deploy log but the newest Sentry release and the
   last thing you deployed by hand are the usual suspects.

---

## Deploying

### Backend API
The server dir `/home/birhan/birhan-backend` is **not a git checkout** (seeded
from a tarball); it is built **on the server**.

```bash
H=root@191.215.40.44; K=~/.ssh/birhan_deploy; D=/home/birhan/birhan-backend
# 0. back up what's live (src + the built dist) so rollback is a restore
ssh -i $K $H "cd $D && tar czf /root/birhan-backend-pre-\$(date +%F-%H%M).tgz src dist"
# 1. copy changed sources up, hand them to the birhan user
scp -i $K backend/src/<changed>.ts $H:$D/src/<same path>
ssh -i $K $H "chown -R birhan:birhan $D/src"
# 2. build (tsc → dist/) and restart, AS the birhan user's toolchain
ssh -i $K $H "su - birhan -c 'export PATH=/home/birhan/node22/bin:\$PATH; cd $D && npm run build'"
ssh -i $K $H "systemctl restart birhan-api.service"
# 3. verify (wait for boot)
sleep 4; curl -fsS https://api.birhan.online/api/v1/health
```
No dependency change → no `npm ci` needed. Schema changes need a migration run
against the docker Postgres before restart.

### Admin console
```bash
VITE_API_URL=https://api.birhan.online ./admin-web/deploy.sh
```
Builds, **strips `dist/assets/*.map`** (source maps must never ship — they leaked
the source once), `rsync --delete`s to `/var/www/admin.birhan.online`, and chowns
to `www-data`. `VITE_API_URL` is **required** and is not in `.env.local`; the
value is in `admin-web/.env.example`.

### Marketing site + APK
Static `website/` files rsync to `/var/www/birhan.online`. A new APK goes to
`/downloads/birhan-<version>.apk` (and `birhan.apk`) via a resumable `.part`
upload, a **server-side SHA-256 check before the atomic swap**, then the update
manifest is published (below). Old APKs are never deleted — they are the mobile
rollback targets.

---

## Mobile self-update (how the app upgrades itself)

The app polls a JSON manifest and offers the download when `versionCode` is
higher than the installed one. The manifest is served from **two** places and
both must agree:

- `https://updates.birhan.online/birhan/latest.json`  (what the app reads)
- `https://birhan.online/latest.json`                 (what the download page reads)

Shape: `versionCode`, `versionName`, `apkUrl`, `sha256`, `sizeBytes`,
`releasedAt`, `minSupportedVersionCode`, `notes_am`, `notes_en`, `mandatory`.
Publishing a release writes both files; a mismatch (e.g. only one updated) is the
classic "some users see the update, some don't" bug.

---

## Rolling back

- **API:** restore the most recent pre-deploy tarball and restart — it contains
  the previous `dist/`, so no rebuild is needed.
  ```bash
  ssh -i $K $H "cd $D && tar xzf /root/birhan-backend-pre-<stamp>.tgz && systemctl restart birhan-api.service"
  ```
- **Admin console:** `deploy.sh --delete` wipes the server's previous bundle, so
  roll back by rebuilding from the previous git commit and re-running `deploy.sh`
  (your local `admin-web/dist/` from the prior build also works as-is).
- **Mobile:** repoint **both** manifests at the previous `versionCode`/APK (still
  present under `/downloads`). This stops offering the bad version; it does **not**
  downgrade already-installed apps — a bad *native* bug is escaped by shipping the
  next versionCode forward.

---

## Secrets

Backend secrets live in `/home/birhan/birhan-backend/.env` **on the server only**
(not in the repo). The keys that matter: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`JWT_SECRET`, the `S3_*` set (MinIO), the `TELEGRAM_*` set, the `MAIL_*`/`EMAIL_*`
set, `CORS_ORIGINS`, `PUBLIC_API_URL`. Changing one means editing `.env` and
`systemctl restart birhan-api.service`. Keep a dated `.env.bak-*` beside it (the
convention already on the box).

Admin build needs `VITE_API_URL`. Mobile build needs `EXPO_PUBLIC_SENTRY_DSN` in
the repo `.env` and `SENTRY_AUTH_TOKEN` in the environment for source-map upload.

---

## Monitoring

Sentry org **`ghost-team-21`**, EU region (`de.sentry.io`): projects
**`birhan-mobile`** and **`admin-web`**. Symbolicated mobile crashes require the
release's source maps to have uploaded at build time. See `docs/MONITORING.md`.

---

> **Stale artifacts — do not trust:** `scripts/rollback.sh` and the comments in
> `deploy/nginx/*.conf` still describe a Supabase + Cloudflare Pages pipeline that
> was never how this deployed. They are historical noise; this file is the source
> of truth.

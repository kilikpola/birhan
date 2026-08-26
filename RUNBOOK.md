# Birhan — Operations Runbook

What to do when something breaks, ships, or needs rolling back. Keep this short
and current. Surfaces: **mobile app** (Expo/EAS), **admin web** (Cloudflare Pages),
**backend** (Supabase — Postgres + Edge Functions).

---

## When the site/app is down — first checks, in order

1. **Is it the backend?** Hit the health endpoint:
   `curl https://<PROD_REF>.functions.supabase.co/functions/v1/health`
   - `200 {"status":"ok"}` → Postgres is reachable; problem is elsewhere (client/CDN).
   - `503` or timeout → **Supabase**. Check the [Supabase status page] and your
     project dashboard → is it paused (free tier auto-pauses ~7 days idle), out of
     connections, or mid-incident?
2. **Is it the admin console only?** Open https://admin.birhan.cc. If it 404s/whites
   out but the app works, it's **Cloudflare Pages** — check the Pages dashboard for a
   bad last deploy; roll it back (below).
3. **Is it the mobile app only?** The offline Bible always works (bundled). If sign-in
   / announcements fail but health is 200, suspect the **auth hook** (a 500 on every
   login means the custom access token hook is erroring) or a bad OTA update.
4. **What changed?** Look at the most recent deploy (Actions → Deploy) and the newest
   Sentry release. Most outages are the last deploy — when in doubt, roll back, then
   diagnose.

---

## Reading a Sentry alert

Alerts arrive in Slack/email (not digest). For each:
1. Open the issue → check **environment** (staging vs production) and **release**
   (commit SHA) tags. Staging noise is not an incident.
2. **Blast radius:** "Events" + "Users affected". One user vs thousands changes urgency.
3. **Regression?** If the release tag is the latest deploy and the error is new →
   likely that deploy → consider rollback.
4. **request_id** (Edge Function events) correlates the Sentry event with Supabase
   function logs — search the logs for it.
5. Triage: assign/resolve/ignore. A resolved issue that recurs re-alerts.

Alert rules to have configured (Sentry → each project → Alerts): **new issue** and
**error-rate spike**, both → Slack, real-time. See `docs/MONITORING.md §5`.

---

## Rolling back production

**One command / the auto-revert already tried.** A failed post-deploy health/smoke
auto-runs `scripts/rollback.sh`. To roll back manually:

```bash
export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=…  CF_PAGES_PROJECT=birhan-admin
export SUPABASE_ACCESS_TOKEN=…  PROD_SUPABASE_PROJECT_REF=…
export PREV_RELEASE_REF=$(git tag --list 'release-*' | sort | tail -2 | head -1)
bash scripts/rollback.sh
```

This rolls **admin web** back to the previous Cloudflare deployment and redeploys
**Edge Functions** from the previous `release-*` tag. It intentionally **does not
touch the database** — migrations are expand-then-contract (see
`supabase/MIGRATIONS.md`), so the previous release runs fine against the current
schema. If a *migration* is the culprit, forward-fix with a new migration; do not
hand-revert schema under pressure.

- **Admin web only, fastest:** Cloudflare dashboard → Pages → project → Deployments →
  previous good deploy → **Rollback**. One click.
- **Mobile (OTA):** `eas update:rollback` (or republish the previous update to the
  `production` channel). A bad *native* build requires a new store submission — there
  is no instant native rollback, which is why native changes ship rarely and staged.

---

## Promoting to production

1. Merge to `main` → the **Deploy** workflow auto-deploys to **staging** and smoke-tests it.
2. Verify staging (https://admin-staging.birhan.cc, exercise the changed path).
3. Actions → the running Deploy → the **production** job is **waiting for approval**.
   A reviewer approves it (GitHub Environment gate).
4. Prod deploy runs migrations → functions → admin web → **health + smoke**. If smoke
   fails it **auto-reverts** and the run goes red. On success it tags `release-*`.

Never push straight to production; there is no path that skips staging + approval.

---

## Deploy pipeline at a glance

```
PR  ─▶ CI (tsc, jest, deno, build)  +  Cloudflare preview URL
        │  (RLS integration job on supabase/** changes)
merge ─▶ main
        └─▶ Deploy: STAGING (auto) ─▶ smoke
                    PRODUCTION (manual approval) ─▶ migrate ─▶ deploy ─▶ health+smoke
                                                   └─ fail ⇒ auto-revert + red run
```

---

## Secrets & setup — what a human must provision (NOT in the repo)

GitHub → Settings → Secrets and variables → Actions. **Secrets:**

| Secret | For |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | CLI auth for db push / functions deploy |
| `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_DB_PASSWORD`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` | staging project |
| `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` | production project |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Pages deploy + rollback |
| `ADMIN_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` | admin monitoring + source maps |

**Variables** (non-secret): `CF_PAGES_PROJECT_STAGING`, `CF_PAGES_PROJECT_PROD`.

**Edge Function secrets** (set per project with `supabase secrets set`): `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`NOTIFY_WEBHOOK_SECRET`, `DEBUG_ERROR_SECRET`.

**GitHub Environments** (Settings → Environments): create `staging` and `production`;
add **required reviewers** to `production` (this is the manual-approval gate).

One-time: **baseline the prod migration history** (`supabase/MIGRATIONS.md`), point
`admin.birhan.cc` / `admin-staging.birhan.cc` DNS at the Cloudflare Pages projects,
and confirm daily DB backups are on (Supabase Pro).

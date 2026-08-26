# Error monitoring — Sentry

Birhan reports errors and performance from all three surfaces to **Sentry**. This
doc covers what exists in code, what you must create in Sentry, the env vars per
surface, source-map upload, alerting, and how to verify the whole pipeline.

> **Why Sentry:** it's the only vendor with first-class SDKs for all three of our
> surfaces — React Native (Expo), a Vite React SPA, and Deno Edge Functions —
> so one tool, one alerting model, one release convention covers everything.

---

## 1 · What's wired in code

| Surface | SDK | Init | Captures |
|---|---|---|---|
| **Mobile** (`src/`) | `@sentry/react-native` | `src/lib/monitoring.ts` → called in `src/app/_layout.tsx`; root wrapped in `Sentry.wrap` | Unhandled JS errors, native crashes, unhandled promise rejections, `reportError(...)` in prod, expo-router navigation traces |
| **Admin web** (`admin-web/`) | `@sentry/react` | `admin-web/src/monitoring.ts` → called in `main.tsx`; app wrapped in `Sentry.ErrorBoundary` | Unhandled errors, browser traces, `captureMonitoringError(...)` |
| **Edge Functions** (`supabase/functions/`) | `@sentry/deno` | `supabase/functions/_shared/sentry.ts` (`withSentry` wrapper) | Any unhandled throw in a wrapped handler, tagged with request id |

**Every event carries:** `environment` (staging/production), `release` (commit
SHA), and — once a user signs in — `user.id` **only** (no name, email, church,
or phone). All three integrations **fail safe**: with no DSN set they are
complete no-ops, so local dev, tests, and Expo Go are unaffected.

---

## 2 · What you must create in Sentry (human step)

1. A Sentry org (or use an existing one).
2. **Three projects** (keep them separate so alerts and release health don't mix):
   - `birhan-mobile` (platform: React Native)
   - `birhan-admin` (platform: React)
   - `birhan-edge` (platform: Deno / Node)
3. Copy each project's **DSN** (Settings → Client Keys). DSNs are safe to ship in
   client bundles.
4. Create a Sentry **auth token** with `project:releases` + `org:read` scope for
   source-map upload (used only in CI, never shipped).

---

## 3 · Env vars & secrets per surface

**Mobile** — build-time public env (e.g. EAS build profile / `.env`):
```
EXPO_PUBLIC_SENTRY_DSN=<birhan-mobile DSN>
EXPO_PUBLIC_ENV=production            # or staging
EXPO_PUBLIC_COMMIT_SHA=<git sha>      # CI injects; release id
# EXPO_PUBLIC_SENTRY_TRACES_RATE=0.2  # optional perf sample rate
```
Plus, in `app.json`, replace `REPLACE_WITH_SENTRY_ORG_SLUG` in the
`@sentry/react-native/expo` plugin with your org slug. Source-map upload during
`eas build` needs `SENTRY_AUTH_TOKEN` in the build environment.

**Admin web** — see `admin-web/.env.example`:
```
VITE_SENTRY_DSN=<birhan-admin DSN>
VITE_ENV=production
VITE_COMMIT_SHA=<git sha>
# CI-only (source-map upload, NOT shipped):
SENTRY_AUTH_TOKEN=...  SENTRY_ORG=...  SENTRY_PROJECT=birhan-admin
```

**Edge Functions** — Supabase Edge Function secrets:
```
supabase secrets set \
  SENTRY_DSN=<birhan-edge DSN> \
  SENTRY_ENVIRONMENT=production \
  SENTRY_RELEASE=<git sha> \
  DEBUG_ERROR_SECRET=<random>        # gate for the debug-error function
```

---

## 4 · Source maps (readable stack traces)

- **Mobile:** the `@sentry/react-native/expo` config plugin + `getSentryExpoConfig`
  in `metro.config.js` upload maps automatically during `eas build` when
  `SENTRY_AUTH_TOKEN` is set. For OTA updates: `npx sentry-expo-upload-sourcemaps dist`
  after `eas update`.
- **Admin web:** `@sentry/vite-plugin` (in `vite.config.ts`) uploads maps on
  `vite build` when `SENTRY_AUTH_TOKEN` is present, then strips them from the
  deployed bundle. Without a token it's disabled and the build still succeeds.
- **Edge:** Deno stack traces are TS-level; upload via the Sentry CLI in the
  deploy job if you want file/line mapping (optional).

---

## 5 · Alerting (do NOT rely on the daily digest)

Configure in each Sentry project → **Alerts → Create Alert**:
- **New issue** → notify immediately (Issue alert: "A new issue is created").
- **Error-rate spike** → Metric alert on event count / failure rate over a short
  window (e.g. > N events in 5 min).
- Route both to a **real-time channel**: connect the **Slack** integration
  (Settings → Integrations → Slack) and pick a channel, or use email/PagerDuty.
- Turn **off** the weekly/daily digest as the primary channel.

(These are dashboard settings; they can't be committed to the repo. The RUNBOOK
will reference the alert channel once you've created it.)

---

## 6 · Verify the pipeline end to end

Each surface has a **dev-only** deliberate-error trigger:

- **Mobile:** navigate to `birhan://debug-sentry` (or `router.navigate('/debug-sentry')`)
  in a dev build. Buttons: captureMessage, handled error, unhandled render error,
  native crash. Renders nothing unless `__DEV__` or `EXPO_PUBLIC_ENABLE_DEBUG=1`.
- **Admin web:** the floating "Sentry test (dev)" panel appears bottom-right when
  running `npm run dev` (`import.meta.env.DEV`). Never renders in a prod build.
- **Edge:** `POST /functions/v1/debug-error` with header `x-debug-secret: <DEBUG_ERROR_SECRET>`
  throws a captured error (500 with a request id). `?mode=message` returns 200.
  Without the secret it 404s.

Trigger one of each and confirm the event lands in the matching Sentry project
with the right environment, release, and (if signed in) user id.

---

## 7 · Still needs a human

- Create the Sentry org + 3 projects + DSNs + auth token.
- Set the env vars/secrets above (nothing sensitive is in the repo).
- Fill `app.json`'s org slug placeholder.
- Configure the alert rules + Slack channel (§5).
- Wire `SENTRY_AUTH_TOKEN` + `*_COMMIT_SHA` into CI (comes in the CI phase).

# Known gaps — Supabase migration

The app was migrated off the old Supabase project onto `backend/` (self-hosted
Postgres + Better Auth). All Supabase calls in `src/` are gone except three
places that fail honestly instead of being built around, because the real
backend has no equivalent yet. Each is a product/backend decision, not a
call-site rewrite — do not silently paper over any of these.

## 1. Pastor registration (`src/app/auth.tsx`, `mode === 'pastor'`)

Submitting shows: *"Pastor registration is not available yet."*

The old flow created the account, uploaded the KYC document, and set
`pastor_status: 'pending'` in one submit. The real backend can't do that in
one step:

- `POST /api/v1/pastor-verification/upload-url` and the submit route
  (`POST /api/v1/pastor-verification`) are both gated behind
  `requireVerifiedEmail` — an applicant has to confirm their email (an
  out-of-band step, via the emailed link) before they can even request an S3
  upload URL. This screen has no "check your email, then come back" step in
  its UI.
- Uploading the document itself is a 3-step dance against the new backend
  (`POST upload-url` → `PUT` the file to the returned S3 URL → `POST
  /api/v1/pastor-verification {docPath, branchName}`), not a single
  `supabase.storage.upload()` call.

**To fix:** decide the new flow shape (likely: create the member account via
the existing `signUp()` → show a "verify your email" interstitial → once
verified, a *separate* screen or step calls the 3-step upload + submit).

## 2. "My church isn't listed" signup (`src/app/auth.tsx`, `isOther`)

Submitting shows: *"Registering with a church that isn't listed yet isn't
available."*

The real backend has `churchRequests` as a table and admin-side
list/approve/reject routes (`GET /api/v1/admin/church-requests`, `POST
.../approve`, `POST .../reject`), but nothing in `backend/src/` **creates**
one — grepped the whole service/route tree, confirmed empty. There is no
route for a signed-out user to file this request at all.

**To fix:** add a `POST` endpoint on the backend (e.g. `POST
/api/v1/church-requests`, public) that creates a `churchRequests` row, most
likely alongside a member account created the same way `/api/v1/auth/signup`
does (same "everything in one transaction" concern that route already
documents). Backend work, not a frontend one.

## 3. Push notifications — BUILT (backend), dormant on delivery

The backend subsystem now exists:

- `push_tokens` table (migration 0011), token globally unique so a device that
  changes accounts re-points rather than double-subscribing.
- `POST`/`DELETE /api/v1/me/push-token`, scoped to `ctx.userId`.
- `services/push.ts#sendAnnouncementPush`, wired fire-and-forget into
  `createAnnouncement`: it fans out to every member of the church (except the
  author and the deleted) in each member's language via Expo's push API, and
  prunes tokens Expo reports as `DeviceNotRegistered`. Never throws.
- The app's `savePushToken` now POSTs the token instead of throwing.

**What still blocks actual delivery (needs your accounts, not code):**

- **EAS `projectId`** — `app.json` has none, so `getExpoPushTokenAsync` returns
  null and no token is ever acquired. Run `eas init`.
- **FCM credentials** for Android — an Expo project with FCM v1 (a Firebase
  project + service-account key uploaded to Expo, or `google-services.json`).
  Without it Expo cannot deliver to Android.

Until both are set up, `push_tokens` stays empty and the fanout is a no-op —
correct and harmless, just silent. The **daily-verse reminder** is unaffected:
it is a local notification (`src/lib/dailyVerse.ts`) and needs none of this.

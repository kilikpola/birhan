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

## 3. Push notifications (`src/lib/push.ts`, `savePushToken`)

Calling it throws `Error('Push notifications are not available yet — see
docs/KNOWN_GAPS.md')`. Callers already treat this as non-fatal — it's caught
and reported, never blocks the app.

This is the biggest gap of the three: the old system was a `push_tokens`
table plus RLS (a member reads/writes only their own token) plus a Supabase
Edge Function that fanned out to Expo's push API when an announcement was
inserted. None of it exists in `backend/`:

- No `push_tokens` (or equivalent) table in `backend/src/db/schema.ts`.
- No route under `backend/src/routes/`.
- No fanout trigger anywhere — announcements are created by
  `services/announcements.ts` with nothing downstream of the insert.

**To fix:** needs a table + an authenticated route to store a member's own
token (scoped server-side to `ctx.userId`, the way every other route already
scopes to `ctx.churchId`), *and* a fanout step wired into
`createAnnouncement` (or a job that polls for un-notified announcements).
This is a real backend feature, not a migration of an existing one.

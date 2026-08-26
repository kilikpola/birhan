# ብርሃን · Birhan Admin Console

A small web console for the **platform super-admin** — the one back-office job that doesn't belong on a
pastor's phone: **reviewing pastor verification (KYC) documents** and approving/rejecting applicants,
plus a read-only view of churches and platform counts.

It talks to the **same Supabase project** as the mobile app. All access is enforced by the existing
`super_admin` row-level-security policies (`supabase/04_pastor_verification.sql`) — this page is just a
UI over them. A signed-in user who isn't a `super_admin` sees a locked screen and can read nothing.

## What it does

- **Overview** — live counts: churches, members, verified pastors, pastors awaiting review.
- **Verification** — the queue of `pending_pastor` applicants. View the uploaded document (short-lived
  signed URL from the private `pastor-docs` bucket), then **Approve → pastor** or **Reject** with a reason.
- **Churches** — searchable directory with member counts and Telegram-linked status.

## Setup

```bash
cd admin-web
npm install
cp .env.example .env.local     # fill in your Supabase URL + anon key
npm run dev                    # http://localhost:5180
```

### Create the first super-admin (one time, in the Supabase SQL editor)

There is intentionally no self-service way to become a super-admin. Promote an existing account by hand:

```sql
update profiles set role = 'super_admin' where id = '<the-auth-user-uuid>';
```

Then that user must **sign out and back in** so the access-token hook (`03_auth_hook.sql`) re-stamps
`user_role: super_admin` into their JWT — the RLS policies read it from the token, not the row.

## Build & deploy

```bash
npm run build      # outputs static files to dist/
```

`dist/` is a plain static site — deploy it to Netlify, Vercel, Cloudflare Pages, or any static host.
Set the two `VITE_SUPABASE_*` variables in the host's environment. The anon key is safe to ship in a
client bundle; RLS is the security boundary. **Restrict who can reach the URL anyway** (host-level
password / allowlist) — defense in depth, since the login form is otherwise public.

## Notes / assumptions

- Reads `profiles.pastor_status` (`pending` | `approved` | `rejected`) and `pastor_doc_path`, both added
  in `04_pastor_verification.sql`.
- **Approve** sets `role='pastor'`, `pastor_status='approved'`. **Reject** reverts `role='member'`,
  sets `pastor_status='rejected'` and stores the reason — the applicant can re-apply.
- This console does **not** send the applicant a notification on decision. If you want that, add an
  email/FCM step (a Supabase Edge Function on a `pastor_status` change is the clean place).

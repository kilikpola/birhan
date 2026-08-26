# Push notifications — setup

The church loop: a pastor posts an announcement → every member's phone lights up.
Transport is the **Expo push service** (no Firebase SDK in the app); on Android it delivers over FCM.

Pieces already in the repo:
- Client: `src/lib/push.ts` (registers a token, stores it) wired in `src/app/_layout.tsx`.
- Schema: `supabase/08_push.sql` (adds `profiles.expo_push_token`).
- Fan-out: `supabase/functions/notify-announcement/index.ts` (Edge Function).

## One-time setup

### 1. Give the app an EAS project id
`getExpoPushTokenAsync` needs one. Without it the app runs fine but silently skips push.
```bash
npx eas init          # writes extra.eas.projectId into app config
```

### 2. Android FCM credentials (for production/standalone builds)
Expo needs an FCM key to deliver on Android. With EAS this is one command:
```bash
npx eas credentials    # Android → set up a Google Service Account / FCM V1 key
```
(Push does **not** work in Expo Go for SDK 53+ — use a dev build: `npx expo run:android` or an EAS dev build.)

### 3. Run the schema
Run `supabase/08_push.sql` in the Supabase SQL editor (adds the token column).

### 4. Deploy the Edge Function
```bash
supabase functions deploy notify-announcement
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into deployed functions automatically —
no secrets to set for this one.

### 5. Fire it on new announcements (Database Webhook — recommended)
Supabase Dashboard → **Database → Webhooks → Create a new hook**:
- **Table:** `announcements`
- **Events:** `Insert`
- **Type:** *Supabase Edge Function* → `notify-announcement`

The dashboard stores the service-role auth in Vault and posts `{ record: <new row> }` to the function
with `Authorization: Bearer <SERVICE_ROLE_KEY>`. The function is locked to that: it **rejects any caller
that doesn't present the service-role key** (or, optionally, a shared secret — see below), so a regular
signed-in user can't invoke it to blast push to a church. The dashboard webhook satisfies this out of the
box; no extra config needed.
(Prefer SQL/no dashboard? The commented `pg_net` trigger in `08_push.sql` does the same thing — make sure
it sends the service-role key in the Authorization header.)

**Optional dedicated secret** (instead of sending the service-role key): set an Edge Function secret
`NOTIFY_WEBHOOK_SECRET=<random>` and configure the webhook to send it as the header `x-webhook-secret`.
Either credential is accepted.

## Test it
1. Dev build on a **physical** Android phone, sign in as a member → accept the notification prompt.
   Confirm a token landed: `select display_name, expo_push_token from profiles where expo_push_token is not null;`
2. As a pastor of the same church, post an announcement.
3. The member's phone should buzz within a few seconds. Tap it → the app opens.

Quick manual check of the function without posting (the service-role key is required — without it the
function now returns `401 unauthorized`):
```bash
curl -X POST 'https://<REF>.functions.supabase.co/notify-announcement' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' -H 'Content-Type: application/json' \
  -d '{"record":{"id":"test","church_id":"<CHURCH_UUID>","title_en":"Test","body":"Hello"}}'
```

## Notes
- The author of an announcement is excluded from its own push.
- Body is trimmed to ~178 chars in the notification; the full text is in the app.
- Expo returns delivery receipts (`receipts` in the response); a production hardening step is to read
  them back and clear tokens that come back `DeviceNotRegistered`. Not required for launch.
- Daily-devotion push (spec §5) can reuse this exact function shape on a scheduled trigger later; the
  verse-of-day is currently computed on-device, so it isn't wired to push yet.

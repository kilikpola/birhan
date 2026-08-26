# Step 4 — Supabase setup (do this first)

You need a Supabase project before any of the app code runs. ~10 minutes.

## 1. Create the project

1. Go to `https://supabase.com` → sign in (GitHub login is fine) → **New project**.
2. Name: `birhan`. Set a strong database password (save it in a password manager — you'll rarely need it, but losing it is painful).
3. **Region: choose the closest to Ethiopia.** Supabase has no African region yet; **`eu-central-1` (Frankfurt)** or **`eu-west` (Ireland)** is the lowest-latency realistic choice. Not US — every millisecond is a user on a slow connection.
4. Wait ~2 minutes for it to provision.

## 2. Get your keys

Project → **Settings → API**. Copy two things:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon / public key** — a long JWT starting `eyJ...`

The `anon` key is safe to ship in the app — it's public by design; RLS is what protects your data, not key secrecy. **Never ship the `service_role` key.** It bypasses RLS. It lives only on a server, never in the app.

## 3. Create the schema

Project → **SQL Editor → New query**. Paste the entire contents of `supabase/01_schema.sql`, run it. Then do the same with `supabase/02_rls.sql`, then `supabase/03_auth_hook.sql`.

Run them in order — 01, 02, 03 — because later files depend on tables and functions from earlier ones.

## 4. Wire the auth hook

The auth hook (`03_auth_hook.sql`) puts `church_id` and `role` into the JWT so RLS can read them for free. After running the SQL, you must **enable** it:

Project → **Authentication → Hooks (Custom Access Token)** → enable → select the function `custom_access_token_hook`. Save.

Without this step the token won't carry `church_id`, and every RLS policy that checks it will deny — so if you're logged in but see no announcements, this hook is why.

## 5. Turn off email confirmation for now (dev only)

Project → **Authentication → Providers → Email** → turn **OFF** "Confirm email" while developing, so test signups work instantly. **Turn it back ON before real users** — you don't want unverified accounts in production.

## 6. Seed the church list so signup has something to pick

SQL Editor, run:

```sql
-- Clean up old test data if any
truncate table churches cascade;

-- Seed the 7 primary church networks
insert into churches (name_am, name_en, denomination, city) values
('የኢትዮጵያ ወንጌላዊት ቤተ ክርስቲያን መካነ ኢየሱስ (EECMY)', 'Ethiopian Evangelical Church Mekane Yesus (EECMY)', 'EECMY', 'Addis Ababa'),
('የኢትዮጵያ ቃለ ሕይወት ቤተ ክርስቲያን (EKHC)', 'Ethiopian Kale Heywet Church (EKHC)', 'EKHC', 'Addis Ababa'),
('የኢትዮጵያ ሙሉ ወንጌል አማኞች ቤተ ክርስቲያን (Mulu Wongel)', 'Ethiopian Full Gospel Believers'' Church (Mulu Wongel)', 'Mulu Wongel', 'Addis Ababa'),
('አማኑኤል ኅብረት ቤተ ክርስቲያን (Emmanuel United Church)', 'Emmanuel United Church', 'Emmanuel', 'Addis Ababa'),
('የባፕቲስት አብያተ ክርስቲያናት (Baptist churches)', 'Baptist churches', 'Baptist', 'Addis Ababa'),
('ሕይወት ብርሃን ቤተ ክርስቲያን (Hiwot Berhan Church)', 'Hiwot Berhan Church', 'Hiwot Berhan', 'Addis Ababa'),
('መሠረተ ክርስቶስ ቤተ ክርስቲያን (MKC)', 'Meserete Kristos Church (MKC)', 'MKC', 'Addis Ababa');
```

## 7. Put your keys in the app

Create `.env` in your project root (and add `.env` to `.gitignore` — never commit keys):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOURPROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

`EXPO_PUBLIC_` prefix is required — Expo only exposes env vars with that prefix to the app.

## 8. Install client deps

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
```

(You already have async-storage from Step 3 — that's fine.)

## Then

Drop the `src/` files from this step in, and `npx expo run:android`. The app will show a login screen; sign up, pick the seeded church, and you're in.

---

## The one thing to understand about offline auth

Supabase stores the session token in AsyncStorage after first login. On every launch, `supabase.auth.getSession()` reads it from disk — **no network call**. So:

- **First run:** must be online to sign in.
- **Every run after:** the Bible opens offline, because the session is read from disk.
- **Only writes** (posting, replying, syncing highlights) need the network; those queue in the outbox when offline.

This is why "login required" doesn't break your offline thesis. The gate is the *first* login, not every open.

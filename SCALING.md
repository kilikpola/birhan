# Birhan — Scaling & Production Readiness

An honest map of what the current architecture handles, where it breaks as usage grows,
and what each tier of growth actually requires. Written 2026-08-03.

> **The one-line truth:** the *reading* side of Birhan scales to unlimited users for free
> because it never touches the server (bundled offline SQLite Bible). The *server* side
> (auth, announcements, replies, resources, push) is a single Supabase Postgres instance
> and scales like any single Postgres instance — well into the low millions of rows with
> the right indexes, and no further without deliberate infrastructure work.

> **100M users across ALL churches (not one church):** this is the *easy* direction. Every
> member-facing query is scoped to one `church_id` (indexed), so a member pays the cost of
> their own church's rows, not the platform's 100M — the app is naturally sharded by church.
> Postgres holds 100M `profiles` rows fine; the index makes each query "find this church's
> slice," independent of total size. The part that does NOT shard is the **super-admin
> console** — its queries aggregate the whole platform ("all members", "all pending
> pastors"). Those are handled by `13_platform_scale.sql`: partial indexes on
> `profiles(pastor_status)` and `profiles(role)` (tiny — almost every row is a plain
> member), an index on `churches(member_count)`, and an **estimated-count RPC**
> (`platform_estimated_counts()`) so the dashboard's "total members" tile is an O(1) planner
> estimate instead of a full 100M-row `count(*)` on every load. Exact counts are kept only
> for the small indexed sets (pending / verified pastors).

---

## 1. What actually hits the backend

| Action | Backend cost | Scales because / breaks when |
|---|---|---|
| Read the Bible, search, highlights, bookmarks | **Zero** — bundled SQLite + local writable DB | Never touches the server. Unlimited users, offline, free. |
| Sign in / token refresh | 1 auth call + 1 profile read (the token hook) | Fine to millions; hook is a single indexed PK lookup. |
| Open Today / announcements | 1 query, capped 50 rows, scoped by `church_id` | Fast **because** `idx_profiles_church` + `idx_announcements_church` exist. |
| Open a reply thread | 1 query, capped 200 rows | Bounded; one viral thread can't OOM the client. |
| Post a reply | 1 insert + rate-limit `count()` trigger | Fast **because** `idx_replies_author` exists. |
| Pastor posts announcement | 1 insert → push fan-out Edge Function | Fan-out is O(members-with-token per church), see §4. |
| Resources list / upload | 1 query capped 200 + Storage object | Storage egress is the cost line, see §3. |

**Design leverage:** every server query is **scoped to one church**. A member only ever reads
their own church's rows. This is natural sharding by `church_id` — the app is effectively
partitioned already, which is why per-church indexes are the whole game.

---

## 2. Growth tiers — what each one needs

### Tier 0 — Pilot (the plan): 3 churches, ~1k users
**Status: ready now.** Free tier. Everything works. The only caveats are operational
(below in §6), not architectural.

### Tier 1 — Regional: ~10k–50k users, dozens of churches
The app's stated design target (spec cost model: "$0–5/mo").
- **Supabase Pro tier** (~$25/mo) — removes the 7-day auto-pause (see §6), raises limits,
  daily backups, no cold-start.
- Indexes from `12_scale_indexes.sql` (already applied) carry this range comfortably.
- **Move Storage egress to a CDN** or Cloudflare R2 (the spec's original call) if resource
  downloads grow — Supabase Storage charges egress; R2 does not.
- Add **pagination UI** to the roster / announcements (queries are already capped; just
  wire "load more" past the first page).

### Tier 2 — National: ~100k–1M users, hundreds of churches
Now you're a real Postgres workload.
- **Connection pooling is mandatory** — use Supabase's Supavisor pooler (transaction mode)
  everywhere; never let clients open direct DB connections. (The mobile client already goes
  through PostgREST, which pools; this matters for any server code you add.)
- **Read replicas** for the read-heavy paths (announcements, resources, roster).
- **Region**: your project is in `eu-west-1`; Ethiopian traffic crosses a continent every
  request. Move to the closest region, or put PostgREST behind a CDN with edge caching for
  the church-list and other near-static reads.
- **Push fan-out** must move to a queue (see §4) — a synchronous loop over a big church
  will time out the Edge Function.
- **Archive old announcements** — implement the spec's `expiresAt` TTL so `announcements`
  and `replies` don't grow unbounded. A monthly job deleting announcements older than N
  months keeps the hot tables small; the client cache already keeps them readable offline.

### Tier 3 — "100M users"
This is not a code change; it is an infrastructure program and a team.
- **Multi-region, multiple databases, sharding by church or region.** No single Postgres
  serves 100M active users.
- **A CDN in front of everything** and aggressive edge caching.
- **A managed queue** (not Edge Functions) for all fan-out.
- **Observability**: dashboards, alerting, load testing, on-call.
- **Cost**: this is a funded-company operating budget, not a hobby project. At this scale
  the honest move is to re-derive the architecture against real traffic data — the numbers
  decide the design, not a document written in advance.

> Reaching Tier 3 is a *success* problem. Nothing in the current code prevents getting
> there; you just don't build Tier 3 machinery until Tier 2 metrics prove you need it.

---

## 3. Storage & egress (the real cost line)

Firebase/Supabase Storage **charges for egress** (bytes downloaded). The Bible avoids this
entirely by being bundled. Resources (church PDFs) and any future audio do not.
- Keep the **"stated size before download"** UX (already built) — it's also a cost control.
- At Tier 1+, put resource files on **Cloudflare R2** (zero egress) and store only the
  metadata row in Postgres. This was the spec's original §2 decision and still stands.

---

## 4. Push fan-out — the one server loop that must change early

`supabase/functions/notify-announcement` currently loops over a church's members
synchronously (batched 100/req to Expo). Fine for a few hundred members. For large churches:
- Move to **fire-and-forget via a queue** (pgmq / a real queue): the insert enqueues a job;
  a worker drains it in batches with retries.
- **Prune dead tokens**: read Expo's delivery receipts and clear `expo_push_token` for
  `DeviceNotRegistered` — otherwise the token table fills with garbage that slows fan-out.

---

## 5. Caching — current state (all client-side, all working)

| Data | Cache | Behaviour |
|---|---|---|
| Bible text | Bundled SQLite | Read-only, offline forever, zero server. |
| Highlights / bookmarks / reading position | Local writable SQLite | Written locally, synced up when online. |
| Announcements | `ann_cache` (SQLite) | Write-through; readable offline. |
| Reply threads | `replies_cache` (SQLite) | Write-through; readable offline. |
| Resources list | AsyncStorage | Falls back to cache offline. |
| Profile (name/church/role) | AsyncStorage | Hydrated on cold start, offline-safe. |
| Session token | AsyncStorage (Supabase) | Read from disk on launch, no network. |

**Server-side caching** (not yet needed): at Tier 2, add edge caching / HTTP cache headers
for near-static reads — the church list, a church's resource list — via a CDN.

---

## 6. Operational readiness (do these before real users)

These are not scale limits; they're launch hygiene the code can't do for you.

- [ ] **Upgrade off the free tier** — free projects **auto-pause after ~7 days idle** (this
      already bit once). Pro tier or a keep-alive ping.
- [ ] **Rotate the exposed credentials** — the DB password and the `passter` password were
      shared in chat; reset both.
- [ ] **Secure the Telegram bot token** — revoke via BotFather, store only as an Edge
      Function secret.
- [ ] **Backups** — confirm daily backups are on (Pro tier) before onboarding a church.
- [ ] **`eas init` + push wiring** — projectId, FCM creds, the announcement→function webhook.
- [ ] **Restrict the admin-web URL** — host-level auth in front of it (defense in depth on
      top of the super_admin RLS).
- [ ] **Bible-text license** — sign-off before Play Store.
- [ ] **Load test Tier 1** before claiming it — seed 10k profiles across 20 churches, script
      100 concurrent announcement reads, watch query times. Cheap insurance.

---

## 7. What's already been hardened (done 2026-08-03)

- `12_scale_indexes.sql` — `idx_profiles_church`, `idx_replies_author`,
  partial `idx_profiles_push_token`, `idx_church_requests_requester`. These were **missing**;
  without `idx_profiles_church` every church-scoped query was a full table scan.
- Bounded previously-unbounded fetches: announcements (50), replies (200), roster (200),
  resources (200) — they had been loading a church's entire history into the client.
- Profile row cached offline (§5).

> Known remaining micro-issue: `getChurchStorageUsed` sums all of a church's resource rows
> client-side. Fine at pilot scale; move to a DB-side `SUM()` via an RPC if a church ever
> holds thousands of documents.

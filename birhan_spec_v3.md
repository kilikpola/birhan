# ብርሃን / Birhan — Technical Specification v3

**Ethiopian Protestant church platform · Android-first · offline-first**
Supersedes *Luz — Architecture Document v1.0*.

---

## 0. Thesis

> **The best offline Amharic Bible and mezmur app that exists.**

Three constraints drive every decision below, and if a decision doesn't trace back to one of them, it's decoration:

1. **Data costs real money.** Every megabyte is the user's money. Nothing downloads without saying its size first.
2. **The network is not there.** Rural coverage, load-shedding, and periodic national shutdowns. Everything a user *reads* must already be on the phone.
3. **The community already exists somewhere else.** Telegram. Don't rebuild it; post into it.

**Non-goals, stated so they stay non-goals:** chat, DMs, member directory, quizzes, video sermons, iOS, a separate web admin panel. Each was in v1. Each is cut. Revisit only with evidence from real churches.

---

## 1. Scope

### Ships in v1 (6 weeks)

| Module | What it is |
|---|---|
| **Bible** | Amharic + English, parallel view, highlights, bookmarks, full-text search. Bundled SQLite. Fully offline from first launch. |
| **Mezmur** | Church-owned worship recordings. Download-with-stated-size, offline playback, background audio. |
| **Today** | Verse of the day + reflection, reading progress, church announcements. |
| **Pastor** | In-app admin: post announcement, manage Telegram link, lock reply threads. Same app, role-gated. |

### Explicitly deferred

| Deferred | Gate that unlocks it |
|---|---|
| Prayer wall | Pilot churches ask for it twice |
| Sermon audio library | A church has ≥5 recordings they own |
| Events + RSVP | A pastor asks for it |
| Telegram bot (auto-post) | Three pilot churches using announcements weekly |
| Bible quiz, iOS, video | Not before year two |

---

## 2. Architecture

```
┌─────────────────────── Android (Expo / React Native) ───────────────────────┐
│                                                                             │
│  ┌────────────────┐   ┌────────────────┐   ┌───────────────────────────┐    │
│  │ bible.db       │   │ mezmur cache   │   │ app state (Zustand)       │    │
│  │ SQLite, ~4 MB  │   │ FileSystem     │   │ + i18n + Ge'ez font       │    │
│  │ BUNDLED in APK │   │ .opus files    │   │ (bundled, not fetched)    │    │
│  │ read-only      │   │                │   │                           │    │
│  └────────────────┘   └────────────────┘   └───────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ local.db (SQLite, writable): highlights, bookmarks, reading position,│   │
│  │ cached announcements, outbound queue (replies written offline)       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ▲                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │  sync when online (opportunistic)
        ┌────────────────────────────┼──────────────────────────────┐
        │                            │                              │
┌───────▼────────┐        ┌──────────▼──────────┐       ┌───────────▼─────────┐
│ Firebase Auth  │        │ Cloud Firestore     │       │ Cloudflare R2       │
│ email+password │        │ users, churches,    │       │ mezmur .opus        │
│ custom claims: │        │ announcements,      │       │ ZERO egress fees    │
│ churchId, role │        │ replies, devotions  │       │ (NOT Firebase Stor.)│
└────────────────┘        └─────────────────────┘       └─────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ Cloud Functions     │
                          │ · daily devotion    │
                          │ · FCM fan-out       │
                          │ · Telegram post     │  ← Phase 2
                          └─────────────────────┘
```

### The five decisions that matter

**1. The Bible never touches Firestore.**
It is 4 MB of text that has not changed in centuries. Ship it as bundled SQLite, queried locally.
v1's design (~30 document reads per chapter) means a Bible-in-a-Year user performs ~11,000 reads on
static text — paid twice, once in your Firebase bill and once in *their* data bundle. Bundled: **zero
reads, zero latency, zero data, works with the radio off.**

**2. The Ge'ez font is bundled, not fetched.**
`@import` from Google Fonts means a low-end Android without Ethiopic glyphs, offline, renders your
**entire Amharic UI as tofu boxes.** Bundle Noto Serif Ethiopic via `expo-font`. Non-negotiable.

**3. Audio lives on R2, not Firebase Storage.**
Egress is the bill. Cloudflare R2 charges zero for egress; Firebase Storage does not. Firebase Storage
for images only.

**4. Church scoping via custom claims, not rule-side reads.**
`churchId` and `role` go in the Auth token. A `get()` inside a security rule costs a read *per rule
evaluation* and adds latency to every request.

**5. Admin is in the app.**
Pastors run their ministry from a phone. A separate React web app at `admin.luzapp.com` doubles your
surface area to serve users who don't have laptops.

---

## 3. Data model

### 3.1 Bundled `bible.db` (read-only SQLite, in APK)

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY,      -- 1..66
  name_am TEXT NOT NULL,       -- ዘፍጥረት
  name_en TEXT NOT NULL,       -- Genesis
  testament TEXT NOT NULL,     -- OT | NT
  chapters INTEGER NOT NULL
);

CREATE TABLE verses (
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text_am TEXT NOT NULL,       -- licensed translation
  text_en TEXT NOT NULL,       -- KJV (public domain)
  PRIMARY KEY (book, chapter, verse)
);

-- Search must work offline. FTS5, built at package time, not runtime.
CREATE VIRTUAL TABLE verses_fts USING fts5(
  text_am, text_en, content='verses', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 0'   -- do NOT strip Ge'ez marks
);
```

> **Ge'ez search note:** users type Amharic with inconsistent gemination and vowel forms
> (ሃ/ሀ/ኀ, ጸ/ፀ, ሰ/ሠ). Normalise both the indexed text and the query through a
> `normalizeAmharic()` function that folds homophone families. Without it, search *looks*
> broken to a native speaker. Test this with an actual Amharic speaker in week 3.

### 3.2 Writable `local.db` (SQLite, on device)

```sql
CREATE TABLE highlights (
  id TEXT PRIMARY KEY, book INT, chapter INT, verse INT,
  color TEXT, note TEXT, updated_at INT, synced INT DEFAULT 0
);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY, book INT, chapter INT, verse INT,
  updated_at INT, synced INT DEFAULT 0
);
CREATE TABLE reading_position (book INT, chapter INT, updated_at INT);
CREATE TABLE announcements_cache (
  id TEXT PRIMARY KEY, church_id TEXT, title_am TEXT, title_en TEXT,
  body TEXT, locked INT, created_at INT, payload TEXT
);
CREATE TABLE outbox (                     -- replies written with no signal
  id TEXT PRIMARY KEY, kind TEXT, target_id TEXT,
  payload TEXT, created_at INT, attempts INT DEFAULT 0
);
```

### 3.3 Firestore

```
users/{uid}
  displayName    string
  email          string
  churchId       string            ← mirrored into custom claims
  role           'member'|'pastor'|'admin'
  language       'am'|'en'
  fcmToken       string
  joinedAt       timestamp

churches/{churchId}
  nameAm, nameEn     string
  denomination       string        -- Mekane Yesus | Kale Hiwot | Mulu Wongel | …
  city               string
  pastorIds          string[]
  telegram: {                      -- ALL OPTIONAL. Nothing depends on it.
    linked           bool
    chatId           string        -- from the bot, never typed by hand
    inviteUrl        string
    memberCount      number        -- reported by bot; verification only
    verifiedAt       timestamp
  }
  memberCount        number        -- maintained by Cloud Function, not client
  createdAt          timestamp

announcements/{id}
  churchId        string           ← scoping key, denormalised
  titleAm, titleEn string
  body            string
  authorId        string
  locked          bool             -- pastor closes replies
  replyCount      number
  postedToTelegram bool
  createdAt       timestamp
  expiresAt       timestamp        -- TTL policy deletes; keeps reads cheap

  announcements/{id}/replies/{replyId}
    authorId, authorName  string
    text                  string
    createdAt             timestamp

devotions/{yyyy-mm-dd}
  verseRef, verseAm, verseEn, reflectionAm, reflectionEn, prayer
```

**Note what is absent:** no `messages`, no `chats`, no `presence`, no message content of any kind. That
absence is a design commitment, not an omission. Don't create the column.

---

## 4. Security rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // claims are set by a Cloud Function on role change — never trusted from client
    function churchId() { return request.auth.token.churchId; }
    function role()     { return request.auth.token.role; }
    function isPastorOf(c) { return role() in ['pastor','admin'] && churchId() == c; }
    function signedIn() { return request.auth != null; }

    match /users/{uid} {
      allow read:   if signedIn() && request.auth.uid == uid;
      allow update: if signedIn() && request.auth.uid == uid
                    // a member cannot promote themselves
                    && !request.resource.data.diff(resource.data)
                         .affectedKeys().hasAny(['role','churchId']);
      allow create: if signedIn() && request.auth.uid == uid
                    && request.resource.data.role == 'member';
    }

    match /churches/{c} {
      allow read:   if signedIn();                 // church list is public to members
      allow update: if isPastorOf(c);
      allow create, delete: if role() == 'admin';
    }

    match /announcements/{a} {
      allow read:   if signedIn() && resource.data.churchId == churchId();
      allow create: if isPastorOf(request.resource.data.churchId);
      allow update, delete: if isPastorOf(resource.data.churchId);

      match /replies/{r} {
        allow read: if signedIn()
                    && get(/databases/$(db)/documents/announcements/$(a)).data.churchId == churchId();
        allow create: if signedIn()
                    && request.resource.data.authorId == request.auth.uid
                    && get(/databases/$(db)/documents/announcements/$(a)).data.locked == false
                    && request.resource.data.text.size() <= 500;
        allow delete: if signedIn() &&
                    (resource.data.authorId == request.auth.uid || role() in ['pastor','admin']);
        allow update: if false;                    // no editing history
      }
    }

    match /devotions/{d} {
      allow read: if signedIn();
      allow write: if role() == 'admin';
    }
  }
}
```

**Rate limit replies** in a Cloud Function (max 10/user/hour). Rules can't do rate limiting, and an
unbounded reply endpoint is a spam surface.

---

## 5. Sync

**Local is truth for reading. Server is truth for church content.**

| Data | Direction | Strategy |
|---|---|---|
| Bible text | never syncs | bundled, read-only |
| Highlights, bookmarks, position | up | write local immediately → mark `synced=0` → flush on connectivity. Last-write-wins on `updated_at`. |
| Announcements | down | fetch on app open + FCM data payload → write to `announcements_cache`. Readable offline forever. |
| Replies | up | write to `outbox` → flush when online. UI shows *"Will send when you're online."* |
| Devotion | down | Cloud Function writes one doc/day; FCM data payload carries it (~1 KB). Client caches 7 days ahead so a week offline still shows a devotion. |

**Flush loop:** on `NetInfo` reachable → drain `outbox` oldest-first, exponential backoff, drop after
5 failed attempts and surface an error the user can retry. Never silently lose a user's writing.

---

## 6. Telegram — the boundary

**The rule, in one line:**
> **Birhan posts into the group. Birhan does not read the group.**

### What it does — three things

1. **Verify.** Pastor adds `@BirhanBot` to his group. Bot reports `chatId` and `memberCount`. This is
   what kills the fake-link problem — a pastor can't paste a dead link and call it done.
2. **Post.** Announcements written in Birhan auto-post to the group. **The incentive is the pastor's,
   not yours:** he types once and reaches everyone, instead of typing everything twice.
3. **Attribute.** Each post carries a small *posted via ብርሃን* footer with an install link. That group
   is full of members who don't have the app. **This is your acquisition loop** — and a better one than
   the Play Store, in a market where the Play Store isn't how people find apps.

### What it does not do

- **Privacy mode stays ON.** In Telegram, a bot in privacy mode receives only commands and direct
  replies. Group conversation is invisible to your servers *by construction.* You don't have to be
  trusted not to read the group — **you are unable to.** That's a stronger promise, and it's the
  sentence you say to a pastor who asks.
- **No group creation.** The Bot API cannot create groups; that requires MTProto and a user session
  (handing your app a pastor's personal Telegram credentials — never). And bots cannot add members
  anyway. So: **a human creates the group, on the pastor's phone, during onboarding.** Ninety seconds.
  He owns it. You are automating a task that occurs three times — don't.
- **No two-way sync.** Replies in the group stay in the group. Syncing them back requires reading the
  group. That's the line.

### It is never load-bearing
Telegram has been throttled in Ethiopia during shutdowns. Service times, fasting dates, announcements
and scripture all live **in the app, cached, readable with the network dead.** If Telegram vanishes
tomorrow, Birhan loses a button.

### Churches with no group
Nothing breaks. The announcement still pushes to every member and still works offline. They get the
**in-app reply thread** instead:

- One thread per announcement. Not a chat.
- No DMs, no presence, no typing indicators, no read receipts, no group management.
- Pastor can lock any thread. 500-char limit. Delete your own; pastor deletes any.
- ~200 lines of code. 80% of the value at 5% of the cost — and *bounded*, so it cannot grow into a
  support burden.

**Never make a pastor do work for your benefit.** The group is optional, the reason for it is his, and
nothing essential depends on it.

---

## 7. Licensing — resolve before writing code

This is the item that can end the project, and v1 never mentions it once.

| Asset | Status | Action |
|---|---|---|
| **Amharic 1954 / 2000** | © Bible Society of Ethiopia | Written permission **before** you build the reader. Non-commercial ministry use is often granted — but *ask*. |
| **NIV** | © Biblica, licensed and expensive | **Drop it. Use KJV** — public domain, free, forever. |
| **Mezmur (commercial)** | © the artists | v1 named Teddy Tadesse, Lily Tilahun, Suraphel Demissie. Redistributing those recordings is a takedown, a Play Store removal, and it happens **the week you get popular**. |
| **Mezmur (launch set)** | church-owned choir recordings | Churches upload their own, with a rights checkbox. Approach artists later, once you have an audience to offer them. |
| **Noto Serif Ethiopic** | SIL Open Font License | Free to bundle. Include the license file. |

---

## 8. Cost model

**At ~10,000 users, monthly:**

| Line | Cost | Note |
|---|---|---|
| Firestore reads | ~free | *only because the Bible isn't in it.* With it: blows the 50k/day free tier and keeps climbing. |
| Firebase Auth | free | email+password. **Phone OTP costs money per SMS** — skip it at launch. |
| FCM | free | unlimited |
| Audio egress (R2) | ~$0 | zero egress fees. On Firebase Storage this is your entire bill. |
| R2 storage | ~$0.15 | 100 songs × 2 MB |
| Cloud Functions | ~free | one scheduled devotion + FCM fan-out |
| **Total** | **≈ $0–5/mo** | which is the point |

**Revenue — pick one now, not later:**

1. **Diaspora donations.** In-app "support your church" tied to a specific church. Ethiopian diaspora
   funding an app their family uses at home is the most plausible line by a distance.
2. **Churches pay** a small monthly fee for pastor features. Realistic ceiling is low.
3. **Nobody pays; you fund it.** Legitimate — but only survivable if marginal cost is near zero, which
   is one more argument for bundled SQLite and R2.

---

## 9. Corrections carried from v1

- **በይት → ቤት.** "Home" was misspelled in the splash and tab bar.
- **መጽሐፍ vs መፅሐፍ** — the doc used both. Pick መጽሐፍ.
- **The devotion date was hardcoded** to *Meskerem 28, 2018* (that's September/October) in a document
  dated April 2026. Compute it. Today is **ሐምሌ ፬ ፣ ፳፻፲፰**. `toEthiopian()` in the prototype is the
  JDN-based conversion — correct across leap years and Pagume.
- **Emoji as an icon system** (⛪ 🙏 📖) renders differently on every Android skin. SVG set.
- `overflow:hidden` + `height: calc(100vh - 120px)` breaks under mobile browser toolbars.
- **The name.** *Luz* is not Amharic and does not mean light — that's Spanish. In Hebrew it's the old
  name of Bethel (Gen 28:19). **ብርሃን / Birhan** means light, and it's a word Ethiopians already say.

---

## 10. Build plan — six weeks

| Week | Deliverable | Done when |
|---|---|---|
| **1** | Expo init, theme tokens, **bundled Ge'ez font**, i18n scaffold, Ethiopian calendar util. Bible → SQLite pipeline, FTS5 index, packaged into APK. | App opens offline and prints a verse in Ge'ez. |
| **2** | Bible reader: book/chapter nav, am/en/parallel, highlights + bookmarks (local), FTS search with Amharic normalisation. | Psalm 23 in Amharic, airplane mode, from cold start. |
| **3** | **Test on a real 2 GB Android, on real Ethio Telecom data, in a real church.** Cold start, scroll perf, tofu-box check, airplane mode, Amharic search with a native speaker. Fix what breaks. | See §11. |
| **4** | Mezmur: list, download-with-stated-size, offline playback, background audio, Wi-Fi-only toggle. R2 bucket + upload form (not a panel). | A song downloads on Wi-Fi and plays with the radio off. |
| **5** | Auth (email+password), church selection, Today screen, devotion via FCM data payload, announcements + reply threads, pastor admin. | A pastor posts; a member sees it offline the next morning. |
| **6** | Play Store listing, APK for direct/Telegram distribution, **three pilot churches onboarded in person.** | Three churches using it, not three churches signed up. |

**Then, gated on evidence:** prayer wall → sermon audio → events → Telegram bot. If the pilot churches
aren't using announcements weekly, the church features were never the product, and you go deeper on
Bible and mezmur instead.

---

## 11. The week-3 test

One question, on a real phone, on real data, in a real church:

> **Can a member read Psalm 23 in Amharic, with the phone in airplane mode, within 3 seconds of tapping the icon?**

If yes, you have a product. If no, no number of modules will save it.

**Device floor:** a 2 GB RAM Android with no Ethiopic system font. If it works there, it works everywhere.
Also check: APK under 30 MB (people share APKs over Telegram and Bluetooth here — size is distribution),
cold start under 2s, and Amharic search tested by someone who actually types Amharic.

---

*✦ ብርሃን — light for every believer, with or without a signal. ✦*

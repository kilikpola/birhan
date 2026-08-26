-- ============================================================
-- Birhan — schema  (run first)
-- Postgres / Supabase. Replaces Firestore spec §3.3.
-- ============================================================

-- Churches --------------------------------------------------
create table churches (
  id            uuid primary key default gen_random_uuid(),
  name_am       text not null,
  name_en       text not null,
  denomination  text,
  city          text,
  -- Telegram is OPTIONAL. Nothing depends on it. (spec §6)
  telegram_url  text,
  telegram_chat_id text,
  telegram_verified_at timestamptz,
  member_count  int not null default 0,
  created_at    timestamptz not null default now()
);

-- Profiles (1:1 with auth.users) ----------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  church_id   uuid references churches(id),
  branch_name text,
  role        text not null default 'member'
              check (role in ('member','pastor','admin')),
  language    text not null default 'am' check (language in ('am','en')),
  created_at  timestamptz not null default now()
);

-- Announcements ---------------------------------------------
create table announcements (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  author_id     uuid not null references profiles(id),
  title_am      text,
  title_en      text,
  body          text not null,
  locked        boolean not null default false,   -- pastor closes replies
  posted_to_telegram boolean not null default false,
  created_at    timestamptz not null default now()
);
create index idx_announcements_church on announcements(church_id, created_at desc);

-- Replies (bounded thread, one per announcement) ------------
create table replies (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  author_id       uuid not null references profiles(id),
  author_name     text not null,
  text            text not null check (char_length(text) <= 500),
  created_at      timestamptz not null default now()
);
create index idx_replies_ann on replies(announcement_id, created_at);

-- Keep churches.member_count honest -------------------------
create or replace function bump_member_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT' and new.church_id is not null) then
    update churches set member_count = member_count + 1 where id = new.church_id;
  elsif (tg_op = 'UPDATE' and new.church_id is distinct from old.church_id) then
    if old.church_id is not null then
      update churches set member_count = member_count - 1 where id = old.church_id;
    end if;
    if new.church_id is not null then
      update churches set member_count = member_count + 1 where id = new.church_id;
    end if;
  end if;
  return new;
end $$;

create trigger trg_member_count
after insert or update on profiles
for each row execute function bump_member_count();

-- Rate-limit replies: max 10 per user per hour --------------
create or replace function check_reply_rate() returns trigger
language plpgsql security definer as $$
declare recent int;
begin
  select count(*) into recent from replies
  where author_id = new.author_id and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'reply rate limit exceeded';
  end if;
  return new;
end $$;

create trigger trg_reply_rate
before insert on replies
for each row execute function check_reply_rate();

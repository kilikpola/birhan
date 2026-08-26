-- Enums
DO $$ BEGIN
  CREATE TYPE role AS ENUM ('member', 'pending_pastor', 'pastor', 'admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pastor_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE language AS ENUM ('am', 'en');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE resource_category AS ENUM ('sermon_notes', 'study_guide', 'calendar', 'announcement_doc', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users table (Better Auth compatible)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  phone TEXT UNIQUE,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table (Better Auth compatible)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Churches
CREATE TABLE IF NOT EXISTS churches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_am TEXT NOT NULL,
  name_en TEXT NOT NULL,
  denomination TEXT,
  city TEXT,
  telegram_chat_id TEXT,
  telegram_verified_at TIMESTAMPTZ,
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Branches
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name_am TEXT NOT NULL,
  name_en TEXT NOT NULL,
  -- The foreign key to profiles is added further down, once profiles exists.
  -- Declaring it here made this file unrunnable on an empty database: profiles
  -- is created after branches, so the reference pointed at nothing and the
  -- whole migration aborted.
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT UNIQUE,
  church_id UUID NOT NULL REFERENCES churches(id),
  branch_id UUID REFERENCES branches(id),
  role role NOT NULL DEFAULT 'member',
  language language NOT NULL DEFAULT 'am',
  church_role TEXT,
  pastor_status pastor_status,
  pastor_doc_path TEXT,
  pastor_rejected_reason TEXT,
  pastor_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Now that profiles exists, branches can point at it. Guarded so re-running
-- this file against a database that already has the constraint is a no-op.
DO $$ BEGIN
  ALTER TABLE branches
    ADD CONSTRAINT branches_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  title_am TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  posted_to_telegram BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Replies
CREATE TABLE IF NOT EXISTS replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  author_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resources
CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  title_am TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description TEXT,
  category resource_category NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  rights_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS branches_church_id_idx ON branches(church_id);
CREATE INDEX IF NOT EXISTS profiles_church_id_idx ON profiles(church_id);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_idx ON profiles(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS announcements_church_id_created_at_idx ON announcements(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS replies_announcement_id_created_at_idx ON replies(announcement_id, created_at);
CREATE INDEX IF NOT EXISTS resources_church_id_created_at_idx ON resources(church_id, created_at DESC);

-- Trigger: update churches.member_count
CREATE OR REPLACE FUNCTION update_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE churches SET member_count = member_count + 1 WHERE id = NEW.church_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE churches SET member_count = member_count - 1 WHERE id = OLD.church_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.church_id IS DISTINCT FROM NEW.church_id THEN
    UPDATE churches SET member_count = member_count - 1 WHERE id = OLD.church_id;
    UPDATE churches SET member_count = member_count + 1 WHERE id = NEW.church_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_member_count_trigger ON profiles;
CREATE TRIGGER profiles_member_count_trigger
AFTER INSERT OR DELETE OR UPDATE OF church_id ON profiles
FOR EACH ROW EXECUTE FUNCTION update_member_count();

-- Trigger: reply rate limit (max 10 per hour per author)
CREATE OR REPLACE FUNCTION check_reply_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM replies
  WHERE author_id = NEW.author_id
    AND created_at > NOW() - INTERVAL '1 hour';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit: more than 10 replies in the past hour';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS replies_rate_limit_trigger ON replies;
CREATE TRIGGER replies_rate_limit_trigger
BEFORE INSERT ON replies
FOR EACH ROW EXECUTE FUNCTION check_reply_rate_limit();

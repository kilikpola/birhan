-- Church registration requests
DO $$ BEGIN
  CREATE TYPE church_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS church_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL,
  name_am TEXT,
  city TEXT,
  denomination TEXT,
  status church_request_status NOT NULL DEFAULT 'pending',
  created_church_id UUID REFERENCES churches(id) ON DELETE SET NULL,
  rejected_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS church_requests_status_idx ON church_requests(status);
CREATE INDEX IF NOT EXISTS church_requests_requester_idx ON church_requests(requested_by);
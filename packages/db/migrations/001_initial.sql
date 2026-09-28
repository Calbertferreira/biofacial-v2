CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone varchar(80) NOT NULL,
  venue varchar(240) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'active', 'finished', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  email varchar(320),
  phone_e164 varchar(16),
  invitation_token_hash char(64) NOT NULL UNIQUE,
  invitation_status varchar(24) NOT NULL DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'accepted', 'declined', 'expired')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS guests_event_id_idx ON guests(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS guests_event_email_idx ON guests(event_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS guests_event_phone_idx ON guests(event_id, phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE RESTRICT,
  guest_id uuid REFERENCES guests(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_event_time_idx ON audit_events(event_id, created_at DESC);

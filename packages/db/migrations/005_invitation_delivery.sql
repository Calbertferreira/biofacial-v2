ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_invitation_status_check;
ALTER TABLE guests ADD CONSTRAINT guests_invitation_status_check
  CHECK (invitation_status IN ('pending', 'registered', 'invited', 'accepted', 'attended', 'declined', 'expired'));
UPDATE guests SET invitation_status = 'registered' WHERE invitation_status = 'pending';
ALTER TABLE guests DROP CONSTRAINT guests_invitation_status_check;
ALTER TABLE guests ADD CONSTRAINT guests_invitation_status_check
  CHECK (invitation_status IN ('registered', 'invited', 'accepted', 'attended', 'declined', 'expired'));
ALTER TABLE guests ALTER COLUMN invitation_status SET DEFAULT 'registered';
ALTER TABLE guests ADD COLUMN send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0);

CREATE TABLE invitation_tokens (
  token_hash char(64) PRIMARY KEY,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_tokens_guest_idx ON invitation_tokens(guest_id);

CREATE TABLE invitation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  channel varchar(16) NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  destination varchar(320) NOT NULL,
  provider_message_id varchar(255),
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (guest_id, attempt_number, channel)
);
CREATE INDEX invitation_deliveries_guest_time_idx ON invitation_deliveries(guest_id, created_at DESC);

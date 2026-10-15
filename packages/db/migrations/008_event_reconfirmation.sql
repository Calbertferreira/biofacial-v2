ALTER TABLE events ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE events ADD COLUMN cancelled_at timestamptz;

ALTER TABLE guests ADD COLUMN confirmed_revision integer;
UPDATE guests SET confirmed_revision = 1
 WHERE invitation_status IN ('accepted', 'attended');
ALTER TABLE guests DROP CONSTRAINT guests_invitation_status_check;
ALTER TABLE guests ADD CONSTRAINT guests_invitation_status_check
  CHECK (invitation_status IN ('registered', 'invited', 'accepted', 'attended', 'reconfirmation_pending', 'declined', 'expired'));

CREATE TABLE event_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  changed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action varchar(16) NOT NULL CHECK (action IN ('updated', 'cancelled')),
  reason text NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  reconfirmation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_changes_event_time_idx ON event_changes(event_id, created_at DESC);

CREATE TABLE guest_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  event_revision integer NOT NULL,
  response varchar(16) NOT NULL CHECK (response IN ('accepted', 'declined')),
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_responses_event_revision_idx ON guest_responses(event_id, event_revision);
INSERT INTO guest_responses (event_id, guest_id, event_revision, response, responded_at)
 SELECT event_id, id, 1, 'accepted', COALESCE(accepted_at, created_at)
 FROM guests WHERE invitation_status IN ('accepted', 'attended');

ALTER TABLE invitation_deliveries ADD COLUMN purpose varchar(20) NOT NULL DEFAULT 'invitation'
  CHECK (purpose IN ('invitation', 'event_change'));
ALTER TABLE invitation_deliveries ADD COLUMN event_revision integer;

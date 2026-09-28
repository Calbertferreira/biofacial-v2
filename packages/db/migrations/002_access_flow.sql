ALTER TABLE guests ADD COLUMN IF NOT EXISTS face_profile_id varchar(128);

CREATE TABLE IF NOT EXISTS access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  guest_id uuid REFERENCES guests(id) ON DELETE RESTRICT,
  action varchar(16) NOT NULL CHECK (action IN ('entry', 'exit', 'denied')),
  reason varchar(80),
  confidence numeric(6,5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'denied' AND reason IS NOT NULL) OR (action <> 'denied' AND guest_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS access_events_event_time_idx ON access_events(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS access_events_guest_time_idx ON access_events(guest_id, created_at DESC);

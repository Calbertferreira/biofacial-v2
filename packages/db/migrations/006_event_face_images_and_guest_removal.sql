ALTER TABLE face_profiles ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE RESTRICT;
ALTER TABLE face_profiles ADD COLUMN image_ciphertext bytea;
UPDATE face_profiles p SET event_id = g.event_id FROM guests g WHERE g.id = p.guest_id;
ALTER TABLE face_profiles ALTER COLUMN event_id SET NOT NULL;
CREATE INDEX face_profiles_event_idx ON face_profiles(event_id);

-- Older releases could point a guest at another event's facial profile.
UPDATE guests g SET face_profile_id = NULL
FROM face_profiles p
WHERE g.face_profile_id = p.id::text AND (p.guest_id <> g.id OR p.event_id <> g.event_id);

ALTER TABLE guests ADD COLUMN deleted_at timestamptz;
DROP INDEX IF EXISTS guests_event_email_idx;
DROP INDEX IF EXISTS guests_event_phone_idx;
CREATE UNIQUE INDEX guests_event_email_idx ON guests(event_id, lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX guests_event_phone_idx ON guests(event_id, phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

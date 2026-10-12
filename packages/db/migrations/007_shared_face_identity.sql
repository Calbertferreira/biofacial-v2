-- A pessoa tem uma única foto/modelo facial, reutilizada somente após
-- comparação da selfie em cada novo convite. O vínculo ao evento continua em guests.
CREATE TABLE person_face_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embedding_ciphertext bytea NOT NULL,
  image_ciphertext bytea NOT NULL,
  model varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE person_face_contacts (
  kind varchar(8) NOT NULL CHECK (kind IN ('email', 'phone')),
  value varchar(320) NOT NULL,
  profile_id uuid NOT NULL REFERENCES person_face_profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, value)
);
CREATE INDEX person_face_contacts_profile_idx ON person_face_contacts(profile_id);

ALTER TABLE guests ADD COLUMN person_face_id uuid REFERENCES person_face_profiles(id) ON DELETE SET NULL;
CREATE INDEX guests_person_face_idx ON guests(person_face_id);

-- Migra a foto mais antiga de cada conjunto de contatos. Se dois contatos
-- apontarem para perfis diferentes, não os fundimos automaticamente.
DO $$
DECLARE
  item record;
  matches uuid[];
  target uuid;
BEGIN
  FOR item IN
    SELECT p.*, g.email, g.phone_e164
      FROM face_profiles p JOIN guests g ON g.id = p.guest_id
     WHERE p.image_ciphertext IS NOT NULL AND g.deleted_at IS NULL
     ORDER BY p.created_at, p.id
  LOOP
    SELECT array_agg(DISTINCT profile_id) INTO matches
      FROM person_face_contacts
     WHERE (kind = 'email' AND value = lower(item.email))
        OR (kind = 'phone' AND value = item.phone_e164);
    IF COALESCE(array_length(matches, 1), 0) > 1 THEN
      CONTINUE;
    END IF;
    target := matches[1];
    IF target IS NULL THEN
      INSERT INTO person_face_profiles (embedding_ciphertext, image_ciphertext, model, created_at)
      VALUES (item.embedding_ciphertext, item.image_ciphertext, item.model, item.created_at)
      RETURNING id INTO target;
    END IF;
    IF item.email IS NOT NULL THEN
      INSERT INTO person_face_contacts (kind, value, profile_id)
      VALUES ('email', lower(item.email), target) ON CONFLICT DO NOTHING;
    END IF;
    IF item.phone_e164 IS NOT NULL THEN
      INSERT INTO person_face_contacts (kind, value, profile_id)
      VALUES ('phone', item.phone_e164, target) ON CONFLICT DO NOTHING;
    END IF;
    UPDATE guests SET person_face_id = target
     WHERE id = item.guest_id
       AND NOT EXISTS (
         SELECT 1 FROM guests other
          WHERE other.event_id = item.event_id AND other.id <> item.guest_id
            AND other.person_face_id = target AND other.deleted_at IS NULL
            AND other.invitation_status IN ('accepted', 'attended')
       );
  END LOOP;
END $$;

-- Os campos antigos ficam disponíveis durante a troca dos serviços.
-- Após verificar API e motor novos, outra migração pode remover as cópias antigas.

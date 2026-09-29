CREATE TABLE IF NOT EXISTS face_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL UNIQUE REFERENCES guests(id) ON DELETE RESTRICT,
  embedding_ciphertext bytea NOT NULL,
  model varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS face_profiles_model_idx ON face_profiles(model);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  external_id varchar(120) UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('adm', 'staff', 'gestor')),
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique_idx ON app_users(lower(email));

CREATE TABLE IF NOT EXISTS user_clients (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS user_clients_client_idx ON user_clients(client_id);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id);

ALTER TABLE events ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE RESTRICT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_id varchar(120);
CREATE INDEX IF NOT EXISTS events_client_idx ON events(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_client_external_idx ON events(client_id, external_id) WHERE external_id IS NOT NULL;

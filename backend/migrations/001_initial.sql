CREATE TABLE IF NOT EXISTS app_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_records (
  uid TEXT PRIMARY KEY,
  tier1_record JSONB NOT NULL,
  memory_record JSONB NOT NULL,
  clinical_record JSONB NOT NULL,
  source_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('patient', 'product_insights')),
  patient_uid TEXT REFERENCES patient_records(uid),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
  ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS safety_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  patient_uid TEXT REFERENCES patient_records(uid),
  reason TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS safety_events_created_idx
  ON safety_events(created_at DESC);

CREATE TABLE IF NOT EXISTS product_insight_snapshots (
  id UUID PRIMARY KEY,
  as_of_date DATE NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_insight_snapshots_as_of_idx
  ON product_insight_snapshots(as_of_date DESC, created_at DESC);

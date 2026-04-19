-- ============================================================
-- LINE Messaging Phase E: フォーム・回答・流入パラメータ
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_forms (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id           UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  slug                 TEXT NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT true,
  post_submit_actions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_forms_service
  ON line_messaging_forms (service_id);

CREATE TRIGGER trg_line_messaging_forms_updated_at
  BEFORE UPDATE ON line_messaging_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_forms"
  ON line_messaging_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_forms"
  ON line_messaging_forms FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_form_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         UUID NOT NULL REFERENCES line_messaging_forms(id) ON DELETE CASCADE,
  question_order  INT NOT NULL,
  label           TEXT NOT NULL,
  question_type   TEXT NOT NULL
                  CHECK (question_type IN ('text', 'textarea', 'select', 'number')),
  required        BOOLEAN NOT NULL DEFAULT false,
  options         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, question_order)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_form_questions_form
  ON line_messaging_form_questions (form_id, question_order);

CREATE TRIGGER trg_line_messaging_form_questions_updated_at
  BEFORE UPDATE ON line_messaging_form_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_form_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_form_questions"
  ON line_messaging_form_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_form_questions"
  ON line_messaging_form_questions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_form_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       UUID NOT NULL REFERENCES line_messaging_forms(id) ON DELETE CASCADE,
  public_token  TEXT NOT NULL UNIQUE,
  line_user_id  TEXT,
  utm           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_form_sessions_form
  ON line_messaging_form_sessions (form_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_form_sessions_token
  ON line_messaging_form_sessions (public_token);

COMMENT ON COLUMN line_messaging_form_sessions.utm IS 'utm_source 等の流入パラメータ（JSON）';

ALTER TABLE line_messaging_form_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full line_messaging_form_sessions"
  ON line_messaging_form_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full line_messaging_form_sessions"
  ON line_messaging_form_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_form_responses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id        UUID NOT NULL REFERENCES line_messaging_forms(id) ON DELETE CASCADE,
  session_id     UUID NOT NULL UNIQUE REFERENCES line_messaging_form_sessions(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES line_messaging_contacts(id) ON DELETE SET NULL,
  line_user_id   TEXT,
  answers        JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution    JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_form_responses_form
  ON line_messaging_form_responses (form_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_messaging_form_responses_contact
  ON line_messaging_form_responses (contact_id);

ALTER TABLE line_messaging_form_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_form_responses"
  ON line_messaging_form_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_form_responses"
  ON line_messaging_form_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

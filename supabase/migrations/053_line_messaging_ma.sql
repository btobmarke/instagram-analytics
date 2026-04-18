-- ============================================================
-- LINE Messaging Phase D: イベントログ・MA ルール・シナリオ・リマインダ
-- ============================================================

-- D1: 標準化イベントログ（分析・デバッグ用）
CREATE TABLE IF NOT EXISTS line_messaging_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES line_messaging_contacts(id) ON DELETE SET NULL,
  line_user_id   TEXT,
  trigger_type   TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_events_service_time
  ON line_messaging_events (service_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_messaging_events_contact
  ON line_messaging_events (contact_id);

COMMENT ON TABLE line_messaging_events IS
  'Webhook / MA エンジン由来のイベント（trigger_type はアプリ定義の辞書）';

ALTER TABLE line_messaging_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_events"
  ON line_messaging_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_events"
  ON line_messaging_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- D3/D6: ルール（キーワード自動応答・follow/unfollow トリガ）
CREATE TABLE IF NOT EXISTS line_messaging_ma_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  rule_kind    TEXT NOT NULL
               CHECK (rule_kind IN ('keyword', 'follow', 'unfollow')),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  priority     INT NOT NULL DEFAULT 100,
  match_type   TEXT CHECK (match_type IS NULL OR match_type IN ('exact', 'contains')),
  pattern      TEXT,
  reply_text   TEXT,
  actions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_line_ma_rules_keyword_pattern
    CHECK (
      rule_kind <> 'keyword'
      OR (pattern IS NOT NULL AND length(trim(pattern)) > 0 AND match_type IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_ma_rules_service
  ON line_messaging_ma_rules (service_id, enabled, priority);

COMMENT ON TABLE line_messaging_ma_rules IS
  'MA ルール。keyword は match_type+pattern、follow/unfollow は pattern 不要。actions は JSON 配列（タグ・属性・シナリオ開始等）';

CREATE TRIGGER trg_line_messaging_ma_rules_updated_at
  BEFORE UPDATE ON line_messaging_ma_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_ma_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_ma_rules"
  ON line_messaging_ma_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_ma_rules"
  ON line_messaging_ma_rules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- D4: シナリオ
CREATE TABLE IF NOT EXISTS line_messaging_scenarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_scenarios_service
  ON line_messaging_scenarios (service_id);

CREATE TRIGGER trg_line_messaging_scenarios_updated_at
  BEFORE UPDATE ON line_messaging_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_scenarios"
  ON line_messaging_scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_scenarios"
  ON line_messaging_scenarios FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_scenario_steps (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id              UUID NOT NULL REFERENCES line_messaging_scenarios(id) ON DELETE CASCADE,
  step_order               INT NOT NULL,
  delay_before_seconds     INT NOT NULL DEFAULT 0,
  message_text             TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_scenario_steps_scenario
  ON line_messaging_scenario_steps (scenario_id, step_order);

CREATE TRIGGER trg_line_messaging_scenario_steps_updated_at
  BEFORE UPDATE ON line_messaging_scenario_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_scenario_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_scenario_steps"
  ON line_messaging_scenario_steps FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_scenario_steps"
  ON line_messaging_scenario_steps FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_scenario_enrollments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES line_messaging_contacts(id) ON DELETE CASCADE,
  scenario_id        UUID NOT NULL REFERENCES line_messaging_scenarios(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'cancelled')),
  current_step_order INT NOT NULL DEFAULT 0,
  next_run_at        TIMESTAMPTZ NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, scenario_id)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_scenario_enrollments_due
  ON line_messaging_scenario_enrollments (service_id, status, next_run_at);

CREATE TRIGGER trg_line_messaging_scenario_enrollments_updated_at
  BEFORE UPDATE ON line_messaging_scenario_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_scenario_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_scenario_enrollments"
  ON line_messaging_scenario_enrollments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_scenario_enrollments"
  ON line_messaging_scenario_enrollments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- D5: リマインダ（1 件 = 1 コンタクト・1 時刻）
CREATE TABLE IF NOT EXISTS line_messaging_reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES line_messaging_contacts(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'sent', 'cancelled', 'failed')),
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_reminders_due
  ON line_messaging_reminders (service_id, status, run_at);

CREATE TRIGGER trg_line_messaging_reminders_updated_at
  BEFORE UPDATE ON line_messaging_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_reminders"
  ON line_messaging_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_reminders"
  ON line_messaging_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);

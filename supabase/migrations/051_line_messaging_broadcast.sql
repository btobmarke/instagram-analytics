-- ============================================================
-- LINE Messaging Phase B: テンプレート・一斉配信・予約・履歴
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  body_text    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_templates_service
  ON line_messaging_templates (service_id);

COMMENT ON TABLE line_messaging_templates IS
  '一斉配信などで使うテキストテンプレート（変数はアプリ層で段階的に対応）';

CREATE TRIGGER trg_line_messaging_templates_updated_at
  BEFORE UPDATE ON line_messaging_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_templates"
  ON line_messaging_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_templates"
  ON line_messaging_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_broadcast_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  template_id             UUID NOT NULL REFERENCES line_messaging_templates(id) ON DELETE RESTRICT,
  name                    TEXT,
  snapshot_body_text      TEXT NOT NULL,
  recipient_source        TEXT NOT NULL
                          CHECK (recipient_source IN ('all_followed', 'explicit')),
  explicit_line_user_ids  JSONB,
  scheduled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                  TEXT NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),
  last_error              TEXT,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_broadcast_jobs_service
  ON line_messaging_broadcast_jobs (service_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_broadcast_jobs_due
  ON line_messaging_broadcast_jobs (status, scheduled_at);

COMMENT ON TABLE line_messaging_broadcast_jobs IS
  '一斉配信ジョブ。scheduled_at 以降にバッチが multicast をチャンク送信（最大 500 件/回）。';

CREATE TRIGGER trg_line_messaging_broadcast_jobs_updated_at
  BEFORE UPDATE ON line_messaging_broadcast_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_broadcast_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_broadcast_jobs"
  ON line_messaging_broadcast_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_broadcast_jobs"
  ON line_messaging_broadcast_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS line_messaging_broadcast_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES line_messaging_broadcast_jobs(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed')),
  error_message   TEXT,
  line_request_id TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_broadcast_recipients_job
  ON line_messaging_broadcast_recipients (job_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_broadcast_recipients_job_status
  ON line_messaging_broadcast_recipients (job_id, status);

COMMENT ON TABLE line_messaging_broadcast_recipients IS
  '配信ジョブごとの送信対象と結果（誰に・いつ・成功/失敗）。';

CREATE TRIGGER trg_line_messaging_broadcast_recipients_updated_at
  BEFORE UPDATE ON line_messaging_broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_broadcast_recipients"
  ON line_messaging_broadcast_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_broadcast_recipients"
  ON line_messaging_broadcast_recipients FOR ALL TO service_role USING (true) WITH CHECK (true);

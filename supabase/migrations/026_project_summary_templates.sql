-- ── 横断サマリーテンプレート ─────────────────────────────────────────────────
-- プロジェクト単位で複数のテンプレートを保存できる
-- rows: UnifiedTableRow[] = { id, serviceId, serviceType, metricRef, label }[]

CREATE TABLE IF NOT EXISTS project_summary_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  time_unit    text        NOT NULL DEFAULT 'day'
                           CHECK (time_unit IN ('hour','day','week','month','custom_range')),
  count        integer     NOT NULL DEFAULT 14 CHECK (count > 0),
  range_start  date,
  range_end    date,
  rows         jsonb       NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_summary_templates_project_idx
  ON project_summary_templates (project_id, created_at DESC);

-- updated_at 自動更新（既存 trigger 関数を流用）
CREATE TRIGGER trg_project_summary_templates_updated_at
  BEFORE UPDATE ON project_summary_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS（既存パターンと統一: 認証済みユーザーは全アクセス可）
ALTER TABLE project_summary_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on project_summary_templates"
  ON project_summary_templates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role full access on project_summary_templates"
  ON project_summary_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

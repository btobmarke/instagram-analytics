-- ============================================================
-- サマリーテンプレートテーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS summary_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  time_unit    TEXT        NOT NULL DEFAULT 'day',
  rows         JSONB       NOT NULL DEFAULT '[]',
  custom_cards JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 自動更新（既存 trigger 関数を流用）
CREATE TRIGGER update_summary_templates_updated_at
  BEFORE UPDATE ON summary_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- service_id での絞り込みを高速化
CREATE INDEX idx_summary_templates_service_id
  ON summary_templates(service_id);

-- RLS（既存パターンと統一: 認証済みユーザーは全アクセス可）
ALTER TABLE summary_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on summary_templates"
  ON summary_templates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- service_role によるバッチアクセス
CREATE POLICY "service_role full access on summary_templates"
  ON summary_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

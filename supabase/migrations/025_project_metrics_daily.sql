-- Migration 025: プロジェクト日次指標キャッシュ（集計ジョブ用）
--
-- 背景: 横断サマリーのクエリ時並列取得（Phase A）では、サービス数が増えると
--       レスポンスが遅くなるため、前日分を毎夜バッチで集計してキャッシュする。
--
-- 設計:
--   EAV（Entity-Attribute-Value）形式で metric_ref="table.field" を key にして保存。
--   スキーマ変更なしに新しい指標を追加できる。
--
-- 利用:
--   GET /api/projects/[projectId]/unified-summary
--     → まず project_metrics_daily からキャッシュ読み取り
--     → キャッシュがない期間（今日・直近未集計分）はリアルタイム取得にフォールバック

CREATE TABLE IF NOT EXISTS project_metrics_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  metric_ref  TEXT NOT NULL,   -- "table.field" 形式 (例: ig_account_insight_fact.reach)
  value       NUMERIC,         -- NULL = データなし（サービス設定未完了など）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, service_id, date, metric_ref)
);

CREATE INDEX idx_project_metrics_daily_lookup
  ON project_metrics_daily (project_id, service_id, date DESC);

CREATE INDEX idx_project_metrics_daily_date
  ON project_metrics_daily (project_id, date DESC);

ALTER TABLE project_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON project_metrics_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON project_metrics_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

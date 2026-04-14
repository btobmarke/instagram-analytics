-- ============================================================
-- 033_custom_metrics.sql
--
-- プロジェクトレベルのカスタム指標（計算式）管理
--
-- カスタム指標は既存の service / external 指標を組み合わせた
-- ユーザー定義の計算式指標。
-- colKey 形式: "custom::{id}"
-- 数式中の他指標参照: {{serviceId::metricRef}} 形式
-- ============================================================

-- カスタム指標定義テーブル
CREATE TABLE IF NOT EXISTS project_custom_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                      -- 表示名（例: エンゲージメント率）
  formula     TEXT NOT NULL,                      -- 計算式（例: {{svc::likes}} / {{svc::reach}} * 100）
  unit        TEXT,                               -- 単位（任意, 例: %, 件, 円）
  description TEXT,                              -- 説明（任意）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_custom_metrics_name_unique UNIQUE (project_id, name)
);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION fn_update_custom_metric_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_custom_metric_updated_at
  BEFORE UPDATE ON project_custom_metrics
  FOR EACH ROW EXECUTE FUNCTION fn_update_custom_metric_updated_at();

-- RLS
ALTER TABLE project_custom_metrics ENABLE ROW LEVEL SECURITY;

-- プロジェクトメンバーは読み書き可能
CREATE POLICY "project_custom_metrics_select"
  ON project_custom_metrics FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "project_custom_metrics_insert"
  ON project_custom_metrics FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "project_custom_metrics_update"
  ON project_custom_metrics FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "project_custom_metrics_delete"
  ON project_custom_metrics FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- インデックス
CREATE INDEX IF NOT EXISTS idx_custom_metrics_project_id
  ON project_custom_metrics (project_id);

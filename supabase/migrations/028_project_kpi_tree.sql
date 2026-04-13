-- ── KPIツリーノード ────────────────────────────────────────────────────────────
-- プロジェクト単位で階層ツリーを保存する。
-- node_type: 'folder'（中間ノード）| 'leaf'（KPI・指標参照）

CREATE TABLE IF NOT EXISTS project_kpi_tree_nodes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id    uuid        REFERENCES project_kpi_tree_nodes(id) ON DELETE CASCADE,
  sort_order   integer     NOT NULL DEFAULT 0,
  label        text        NOT NULL,
  node_type    text        NOT NULL DEFAULT 'leaf'
                           CHECK (node_type IN ('folder', 'leaf')),
  -- leaf のみ使用: テンプレートの metricRef またはカスタム指標 ID
  metric_ref   text,
  -- leaf のみ使用: どのサービスの指標か（null = プロジェクト全体／集計）
  service_id   uuid        REFERENCES services(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_kpi_tree_nodes_project_idx
  ON project_kpi_tree_nodes (project_id, parent_id, sort_order);

CREATE TRIGGER trg_project_kpi_tree_nodes_updated_at
  BEFORE UPDATE ON project_kpi_tree_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE project_kpi_tree_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on project_kpi_tree_nodes"
  ON project_kpi_tree_nodes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on project_kpi_tree_nodes"
  ON project_kpi_tree_nodes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 分析プリセット ───────────────────────────────────────────────────────────
-- プロジェクト単位で「Y 変数 / X 変数セット」を複数保存する。

CREATE TABLE IF NOT EXISTS project_analysis_presets (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 text        NOT NULL,
  -- 目的変数（Y）: "{serviceId}.{metricRef}" または metricRef のみ
  target_metric_ref    text        NOT NULL,
  -- 説明変数（X）: 同形式のリスト
  feature_metric_refs  jsonb       NOT NULL DEFAULT '[]',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_analysis_presets_project_idx
  ON project_analysis_presets (project_id, created_at DESC);

CREATE TRIGGER trg_project_analysis_presets_updated_at
  BEFORE UPDATE ON project_analysis_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE project_analysis_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on project_analysis_presets"
  ON project_analysis_presets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on project_analysis_presets"
  ON project_analysis_presets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

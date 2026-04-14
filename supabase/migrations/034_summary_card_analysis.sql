-- ============================================================
-- 034_summary_card_analysis.sql
-- サマリカード（KPIツリー親子単位）回帰分析・検証の保存基盤
-- ============================================================

-- 1) 分析セッション（timeUnit / range をロックする単位）
CREATE TABLE IF NOT EXISTS summary_card_analysis_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_tree_id uuid        NOT NULL REFERENCES kpi_trees(id) ON DELETE CASCADE,
  time_unit   text        NOT NULL CHECK (time_unit IN ('day','week','month')),
  range_start date        NOT NULL,
  range_end   date        NOT NULL,
  status      text        NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','completed','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT summary_card_analysis_sessions_range_check CHECK (range_start <= range_end)
);

CREATE INDEX IF NOT EXISTS idx_sc_analysis_sessions_project_tree
  ON summary_card_analysis_sessions (project_id, kpi_tree_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_analysis_sessions_project_tree_range
  ON summary_card_analysis_sessions (project_id, kpi_tree_id, time_unit, range_start, range_end);

CREATE TRIGGER trg_sc_analysis_sessions_updated_at
  BEFORE UPDATE ON summary_card_analysis_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE summary_card_analysis_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on summary_card_analysis_sessions"
  ON summary_card_analysis_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on summary_card_analysis_sessions"
  ON summary_card_analysis_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2) カード単位の分析結果
CREATE TABLE IF NOT EXISTS summary_card_analysis_results (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES summary_card_analysis_sessions(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_tree_id uuid        NOT NULL REFERENCES kpi_trees(id) ON DELETE CASCADE,
  parent_node_id uuid     NOT NULL REFERENCES project_kpi_tree_nodes(id) ON DELETE CASCADE,
  time_unit   text        NOT NULL CHECK (time_unit IN ('day','week','month')),
  range_start date        NOT NULL,
  range_end   date        NOT NULL,
  y_col_key   text        NOT NULL,               -- "serviceId::metricRef"
  x_col_keys  text[]      NOT NULL,               -- max 20
  ridge_lambda numeric    NOT NULL DEFAULT 1,
  model_json  jsonb       NOT NULL,               -- 係数・標準化パラメータ等（仕様はアプリ側）
  metrics_json jsonb      NOT NULL,               -- r2/mae/rmse/mape/n 等
  series_json jsonb       NOT NULL,               -- [{period, actual, predicted, residual}]
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT summary_card_analysis_results_range_check CHECK (range_start <= range_end)
);

CREATE INDEX IF NOT EXISTS idx_sc_analysis_results_session
  ON summary_card_analysis_results (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_analysis_results_lookup
  ON summary_card_analysis_results (project_id, kpi_tree_id, time_unit, range_start, range_end, parent_node_id);

CREATE TRIGGER trg_sc_analysis_results_updated_at
  BEFORE UPDATE ON summary_card_analysis_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE summary_card_analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on summary_card_analysis_results"
  ON summary_card_analysis_results FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on summary_card_analysis_results"
  ON summary_card_analysis_results FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3) 検証期間（セッション単位）
CREATE TABLE IF NOT EXISTS summary_card_validation_periods (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES summary_card_analysis_sessions(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_tree_id uuid        NOT NULL REFERENCES kpi_trees(id) ON DELETE CASCADE,
  name        text,
  validation_start date   NOT NULL,
  validation_end   date   NOT NULL,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  ai_enabled  boolean     NOT NULL DEFAULT false,
  results_json jsonb      DEFAULT NULL,           -- card単位 + 全体集約
  error_message text      DEFAULT NULL,
  evaluated_at  timestamptz DEFAULT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT summary_card_validation_periods_range_check CHECK (validation_start <= validation_end)
);

CREATE INDEX IF NOT EXISTS idx_sc_validation_periods_session
  ON summary_card_validation_periods (session_id, created_at DESC);

CREATE TRIGGER trg_sc_validation_periods_updated_at
  BEFORE UPDATE ON summary_card_validation_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE summary_card_validation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on summary_card_validation_periods"
  ON summary_card_validation_periods FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on summary_card_validation_periods"
  ON summary_card_validation_periods FOR ALL TO service_role
  USING (true) WITH CHECK (true);


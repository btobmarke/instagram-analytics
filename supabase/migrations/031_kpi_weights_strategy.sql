-- ── KPI 重み バージョン管理 ─────────────────────────────────────────────────
-- 重回帰分析の結果（重み構造）をバージョン管理して保存する

CREATE TABLE IF NOT EXISTS kpi_weight_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  preset_id       uuid        NOT NULL REFERENCES project_analysis_presets(id) ON DELETE CASCADE,
  version_no      integer     NOT NULL DEFAULT 1,
  name            text        NOT NULL DEFAULT '',  -- ユーザーが付けるバージョン名
  -- 回帰結果
  target_ref      text        NOT NULL,
  feature_refs    jsonb       NOT NULL DEFAULT '[]',  -- string[]
  coefficients    jsonb       NOT NULL DEFAULT '[]',  -- {ref: string, coef: number, vif?: number}[]
  intercept       numeric     NOT NULL DEFAULT 0,
  r2              numeric     NOT NULL DEFAULT 0,
  n_obs           integer     NOT NULL DEFAULT 0,
  -- Ridge パラメータ（0 = OLS）
  ridge_lambda    numeric     NOT NULL DEFAULT 0,
  -- 多重共線性警告フラグ
  has_collinearity boolean    NOT NULL DEFAULT false,
  collinearity_detail jsonb   DEFAULT '[]',  -- {ref: string, vif: number}[]
  -- 分析期間
  analysis_start  date        NOT NULL,
  analysis_end    date        NOT NULL,
  time_unit       text        NOT NULL DEFAULT 'day',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preset_id, version_no)
);

CREATE INDEX IF NOT EXISTS kpi_weight_versions_project_idx
  ON kpi_weight_versions (project_id, preset_id, version_no DESC);

CREATE TRIGGER trg_kpi_weight_versions_updated_at
  BEFORE UPDATE ON kpi_weight_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_weight_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on kpi_weight_versions"
  ON kpi_weight_versions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on kpi_weight_versions"
  ON kpi_weight_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 配分戦略 ────────────────────────────────────────────────────────────────
-- 保存した重み構造を元に立てた配分戦略を管理する

CREATE TABLE IF NOT EXISTS kpi_strategy_plans (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  weight_version_id uuid        NOT NULL REFERENCES kpi_weight_versions(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  strategy_type     text        NOT NULL
                    CHECK (strategy_type IN (
                      'proportional',     -- 比例貢献
                      'equal_growth',     -- 均等成長率
                      'efficiency_max',   -- 効率最大化
                      'manual',           -- 手動配分
                      'elasticity'        -- 弾力性表示
                    )),
  -- 目標値設定
  y_target          numeric     NOT NULL,  -- 親ノードの目標値
  y_current         numeric     NOT NULL,  -- 現在値（基準）
  -- 各 X の配分結果
  allocations       jsonb       NOT NULL DEFAULT '[]',
  -- {ref: string, label: string, current: number, target: number, delta: number, delta_pct: number}[]
  -- 手動配分の場合のユーザー入力
  manual_inputs     jsonb       DEFAULT '{}',
  -- AI評価 (後から付加)
  ai_evaluation     jsonb       DEFAULT null,
  -- 評価実行時刻
  evaluated_at      timestamptz DEFAULT null,
  -- 評価対象期間 (AI評価時に指定)
  eval_start        date        DEFAULT null,
  eval_end          date        DEFAULT null,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kpi_strategy_plans_project_idx
  ON kpi_strategy_plans (project_id, weight_version_id, created_at DESC);

CREATE TRIGGER trg_kpi_strategy_plans_updated_at
  BEFORE UPDATE ON kpi_strategy_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_strategy_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on kpi_strategy_plans"
  ON kpi_strategy_plans FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on kpi_strategy_plans"
  ON kpi_strategy_plans FOR ALL TO service_role
  USING (true) WITH CHECK (true);

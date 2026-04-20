-- 059_summary_card_analysis_models.sql
-- サマリカード分析: 複数モデル・ペナルティ種別・ElasticNet α・CV メタ

ALTER TABLE summary_card_analysis_results
  ADD COLUMN IF NOT EXISTS penalty_type text NOT NULL DEFAULT 'ridge'
    CHECK (penalty_type IN ('ridge', 'lasso', 'elastic_net', 'ols')),
  ADD COLUMN IF NOT EXISTS elastic_alpha numeric,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS cv_summary_json jsonb;

COMMENT ON COLUMN summary_card_analysis_results.ridge_lambda IS
  'Ridge/Lasso/ElasticNet のペナルティ強度 λ（OLS では 0 固定）';
COMMENT ON COLUMN summary_card_analysis_results.elastic_alpha IS
  'ElasticNet の α（0=L2のみ, 1=L1のみ）。Ridge/Lasso/OLS では NULL';

CREATE INDEX IF NOT EXISTS idx_sc_analysis_results_parent_created
  ON summary_card_analysis_results (parent_node_id, created_at DESC);

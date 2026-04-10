-- Migration 020: Google 広告 AI分析結果（サービス単位）
--
-- 既存 ai_analysis_results は ig_accounts 前提のため、
-- Google 広告など「サービス単位」の AI 結果は別テーブルに保存する。

CREATE TABLE IF NOT EXISTS ai_service_analysis_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id           UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_type         TEXT, -- 参照の利便性（任意）。例: 'google_ads'
  analysis_type        TEXT NOT NULL, -- 例: 'google_ads_weekly' / 'google_ads_monthly'
  analysis_result      TEXT NOT NULL,
  model_used           TEXT,
  tokens_used          INTEGER,
  target_period_start  DATE,
  target_period_end    DATE,
  triggered_by         TEXT NOT NULL DEFAULT 'user' CHECK (triggered_by IN ('user', 'batch_weekly', 'batch_monthly')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_service_results_service
  ON ai_service_analysis_results(service_id, created_at DESC);

ALTER TABLE ai_service_analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON ai_service_analysis_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON ai_service_analysis_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- =============================================================
-- Phase 2: 外部連携系・集計系テーブル
-- service_integrations / external_fetch_logs
-- metric_summaries / ranking_summaries
-- =============================================================

-- 外部サービス連携設定テーブル（GA4 / Clarity 等）
CREATE TABLE IF NOT EXISTS service_integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  integration_type      VARCHAR(50) NOT NULL,  -- GA4 / CLARITY / INSTAGRAM
  external_project_id   VARCHAR(255),
  encrypted_credential  TEXT,   -- 暗号化済み接続情報（AES-256）
  last_synced_at        TIMESTAMPTZ,
  status                VARCHAR(50) DEFAULT 'active',  -- active / error / inactive
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_integrations UNIQUE (service_id, integration_type),
  CONSTRAINT chk_integration_type CHECK (
    integration_type IN ('GA4','CLARITY','INSTAGRAM')
  )
);

CREATE INDEX IF NOT EXISTS idx_service_integrations_service ON service_integrations(service_id);

-- 外部データ取得ログテーブル
CREATE TABLE IF NOT EXISTS external_fetch_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id          UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  integration_type    VARCHAR(50) NOT NULL,
  fetch_target_date   DATE NOT NULL,
  fetch_status        VARCHAR(50) NOT NULL,  -- SUCCESS / FAILED / PARTIAL
  response_summary    TEXT,
  started_at          TIMESTAMPTZ NOT NULL,
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_fetch_logs_service  ON external_fetch_logs(service_id, integration_type, fetch_target_date DESC);
CREATE INDEX IF NOT EXISTS idx_external_fetch_logs_status   ON external_fetch_logs(fetch_status, started_at DESC);

-- 集計サマリーテーブル（LP サマリー画面の主要指標）
CREATE TABLE IF NOT EXISTS metric_summaries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  metric_name           VARCHAR(100) NOT NULL,
  metric_value_numeric  DECIMAL(18,4),
  metric_value_text     VARCHAR(255),
  range_type            VARCHAR(20) NOT NULL,   -- all / 30d / 7d / today
  source_type           VARCHAR(50) NOT NULL,   -- MA / GA4 / CLARITY
  summary_date          DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_metric_summaries UNIQUE (service_id, metric_name, range_type, summary_date),
  CONSTRAINT chk_range_type CHECK (range_type IN ('all','30d','7d','today')),
  CONSTRAINT chk_source_type CHECK (source_type IN ('MA','GA4','CLARITY'))
);

CREATE INDEX IF NOT EXISTS idx_metric_summaries_lookup ON metric_summaries(service_id, range_type, metric_name, summary_date DESC);

-- ランキングサマリーテーブル（LP サマリー画面のランキング）
CREATE TABLE IF NOT EXISTS ranking_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  ranking_type  VARCHAR(50) NOT NULL,   -- event / page / exit / referrer / stay_bucket
  item_key      VARCHAR(255) NOT NULL,
  item_label    VARCHAR(255),
  rank_no       INT NOT NULL,
  count_value   INT NOT NULL DEFAULT 0,
  range_type    VARCHAR(20) NOT NULL,
  source_type   VARCHAR(50) NOT NULL,
  summary_date  DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ranking_summaries UNIQUE (service_id, ranking_type, range_type, rank_no, summary_date),
  CONSTRAINT chk_ranking_type CHECK (
    ranking_type IN ('event','page','exit','referrer','stay_bucket')
  )
);

CREATE INDEX IF NOT EXISTS idx_ranking_summaries_lookup ON ranking_summaries(service_id, range_type, ranking_type, rank_no);

-- Triggers
CREATE OR REPLACE TRIGGER trg_service_integrations_updated_at
  BEFORE UPDATE ON service_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE service_integrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_fetch_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_summaries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_summaries     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_users_all" ON service_integrations  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON external_fetch_logs   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON metric_summaries      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON ranking_summaries     FOR ALL USING (auth.role() = 'authenticated');

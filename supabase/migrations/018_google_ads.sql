-- Migration 018: Google 広告サービス
--
-- 設計方針:
--   - client_google_ads_credentials : クライアント単位のOAuth認証情報（MCC経由管理）
--   - google_ads_service_configs    : サービス（広告アカウント）設定
--   - google_ads_campaigns          : キャンペーンマスタ
--   - google_ads_ad_groups          : 広告グループマスタ
--   - google_ads_keywords           : キーワードマスタ
--   - google_ads_campaign_daily     : キャンペーン日次指標
--   - google_ads_adgroup_daily      : 広告グループ日次指標
--   - google_ads_keyword_daily      : キーワード日次指標
--   - google_ads_batch_runs         : バッチ実行ログ（将来拡張用。現状は batch_job_logs を主に利用）

-- ─────────────────────────────────────────────────────────────
-- 1. クライアント単位 Google Ads 認証情報
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_google_ads_credentials (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  oauth_client_id_enc     TEXT NOT NULL,
  oauth_client_secret_enc TEXT NOT NULL,
  refresh_token_enc       TEXT,
  manager_customer_id     TEXT NOT NULL,          -- MCC の顧客ID（ハイフンなし10桁）
  google_account_email    TEXT,
  auth_status             TEXT NOT NULL DEFAULT 'pending'
                            CHECK (auth_status IN ('pending', 'active', 'error')),
  scopes                  TEXT[],
  last_verified_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_client_google_ads_credentials_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_client_google_ads_credentials_updated_at
  BEFORE UPDATE ON client_google_ads_credentials
  FOR EACH ROW EXECUTE FUNCTION trg_client_google_ads_credentials_updated_at();

ALTER TABLE client_google_ads_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON client_google_ads_credentials
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON client_google_ads_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. サービス（広告アカウント）設定
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_service_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  customer_id      TEXT NOT NULL,              -- 広告アカウント顧客ID（ハイフンなし10桁）
  account_name     TEXT,
  currency_code    TEXT DEFAULT 'JPY',
  time_zone        TEXT DEFAULT 'Asia/Tokyo',
  collect_keywords BOOLEAN NOT NULL DEFAULT false,
  backfill_days    INTEGER NOT NULL DEFAULT 30,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_google_ads_service_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_google_ads_service_configs_updated_at
  BEFORE UPDATE ON google_ads_service_configs
  FOR EACH ROW EXECUTE FUNCTION trg_google_ads_service_configs_updated_at();

ALTER TABLE google_ads_service_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_service_configs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_service_configs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. キャンペーンマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id           TEXT NOT NULL,
  campaign_name         TEXT NOT NULL,
  status                TEXT,
  campaign_type         TEXT,
  budget_amount_micros  BIGINT,
  bidding_strategy      TEXT,
  start_date            DATE,
  end_date              DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, campaign_id)
);

ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_campaigns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. 広告グループマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_ad_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  ad_group_name  TEXT NOT NULL,
  status         TEXT,
  cpc_bid_micros BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, ad_group_id)
);

ALTER TABLE google_ads_ad_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_ad_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_ad_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 5. キーワードマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id   TEXT NOT NULL,
  ad_group_id   TEXT NOT NULL,
  keyword_id    TEXT NOT NULL,
  keyword_text  TEXT NOT NULL,
  match_type    TEXT,
  status        TEXT,
  quality_score INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, keyword_id)
);

ALTER TABLE google_ads_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_keywords
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_keywords
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 6. キャンペーン日次指標
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_campaign_daily (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,
  ctr                      NUMERIC(8,6),
  average_cpc_micros       BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_daily_service_date
  ON google_ads_campaign_daily (service_id, date DESC);

ALTER TABLE google_ads_campaign_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_campaign_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_campaign_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 7. 広告グループ日次指標
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_adgroup_daily (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  ad_group_id              TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,
  ctr                      NUMERIC(8,6),
  average_cpc_micros       BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, ad_group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_adgroup_daily_service_date
  ON google_ads_adgroup_daily (service_id, date DESC);

ALTER TABLE google_ads_adgroup_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_adgroup_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_adgroup_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 8. キーワード日次指標（collect_keywords=true のサービスのみ保存）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_keyword_daily (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  ad_group_id              TEXT NOT NULL,
  keyword_id               TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,
  ctr                      NUMERIC(8,6),
  average_cpc_micros       BIGINT,
  quality_score            INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_daily_service_date
  ON google_ads_keyword_daily (service_id, date DESC);

ALTER TABLE google_ads_keyword_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_keyword_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_keyword_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 9. バッチ実行ログ（将来拡張用）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_batch_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       UUID REFERENCES services(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'success', 'partial', 'failed')),
  records_inserted INTEGER DEFAULT 0,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE google_ads_batch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_batch_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_batch_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);


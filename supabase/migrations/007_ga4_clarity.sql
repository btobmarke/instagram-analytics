-- =============================================================
-- 007_ga4_clarity.sql
-- GA4 / Clarity 生データ保存テーブル群
-- =============================================================

-- -------------------------------------------------------
-- GA4: 日次サマリー（プロパティ全体集計）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_daily_metrics (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id                UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date               DATE NOT NULL,
  -- セッション・ユーザー
  sessions                  INT NOT NULL DEFAULT 0,
  total_users               INT NOT NULL DEFAULT 0,
  new_users                 INT NOT NULL DEFAULT 0,
  returning_users           INT NOT NULL DEFAULT 0,
  -- エンゲージメント
  engaged_sessions          INT NOT NULL DEFAULT 0,
  engagement_rate           NUMERIC(7,4) NOT NULL DEFAULT 0,
  bounce_rate               NUMERIC(7,4) NOT NULL DEFAULT 0,
  avg_session_duration_sec  NUMERIC(10,2) NOT NULL DEFAULT 0,
  sessions_per_user         NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- ページビュー
  screen_page_views         INT NOT NULL DEFAULT 0,
  views_per_session         NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- コンバージョン・収益
  conversions               INT NOT NULL DEFAULT 0,
  total_revenue             NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- タイムスタンプ
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_daily UNIQUE (service_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_ga4_daily_service_date ON ga4_daily_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- GA4: ページ別日次メトリクス
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_page_metrics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date             DATE NOT NULL,
  page_path               TEXT NOT NULL,
  page_title              TEXT,
  screen_page_views       INT NOT NULL DEFAULT 0,
  total_users             INT NOT NULL DEFAULT 0,
  sessions                INT NOT NULL DEFAULT 0,
  engaged_sessions        INT NOT NULL DEFAULT 0,
  avg_time_on_page_sec    NUMERIC(10,2) NOT NULL DEFAULT 0,
  bounce_rate             NUMERIC(7,4) NOT NULL DEFAULT 0,
  entrances               INT NOT NULL DEFAULT 0,
  exits                   INT NOT NULL DEFAULT 0,
  conversions             INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_page UNIQUE (service_id, report_date, page_path)
);

CREATE INDEX IF NOT EXISTS idx_ga4_page_service_date ON ga4_page_metrics(service_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_page_path         ON ga4_page_metrics(service_id, page_path);

-- -------------------------------------------------------
-- GA4: トラフィックソース別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_traffic_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date       DATE NOT NULL,
  session_source    TEXT NOT NULL,
  session_medium    TEXT NOT NULL,
  session_campaign  TEXT NOT NULL DEFAULT '(not set)',
  sessions          INT NOT NULL DEFAULT 0,
  total_users       INT NOT NULL DEFAULT 0,
  new_users         INT NOT NULL DEFAULT 0,
  engaged_sessions  INT NOT NULL DEFAULT 0,
  conversions       INT NOT NULL DEFAULT 0,
  total_revenue     NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_traffic UNIQUE (service_id, report_date, session_source, session_medium, session_campaign)
);

CREATE INDEX IF NOT EXISTS idx_ga4_traffic_service_date ON ga4_traffic_sources(service_id, report_date DESC);

-- -------------------------------------------------------
-- GA4: イベント別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_event_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date     DATE NOT NULL,
  event_name      TEXT NOT NULL,
  event_count     INT NOT NULL DEFAULT 0,
  total_users     INT NOT NULL DEFAULT 0,
  conversions     INT NOT NULL DEFAULT 0,
  event_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_event UNIQUE (service_id, report_date, event_name)
);

CREATE INDEX IF NOT EXISTS idx_ga4_event_service_date ON ga4_event_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- GA4: デバイス・ブラウザ別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_device_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date       DATE NOT NULL,
  device_category   TEXT NOT NULL,   -- mobile / desktop / tablet
  operating_system  TEXT NOT NULL DEFAULT '(not set)',
  browser           TEXT NOT NULL DEFAULT '(not set)',
  sessions          INT NOT NULL DEFAULT 0,
  total_users       INT NOT NULL DEFAULT 0,
  new_users         INT NOT NULL DEFAULT 0,
  conversions       INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_device UNIQUE (service_id, report_date, device_category, operating_system, browser)
);

CREATE INDEX IF NOT EXISTS idx_ga4_device_service_date ON ga4_device_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- GA4: 地域別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ga4_geo_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date   DATE NOT NULL,
  country       TEXT NOT NULL,
  region        TEXT NOT NULL DEFAULT '(not set)',
  city          TEXT NOT NULL DEFAULT '(not set)',
  sessions      INT NOT NULL DEFAULT 0,
  total_users   INT NOT NULL DEFAULT 0,
  new_users     INT NOT NULL DEFAULT 0,
  conversions   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga4_geo UNIQUE (service_id, report_date, country, region, city)
);

CREATE INDEX IF NOT EXISTS idx_ga4_geo_service_date ON ga4_geo_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- Clarity: 日次サマリー
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS clarity_daily_metrics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date             DATE NOT NULL,
  -- セッション・ユーザー
  total_sessions          INT NOT NULL DEFAULT 0,
  total_users             INT NOT NULL DEFAULT 0,
  -- エンゲージメント
  pages_per_session       NUMERIC(8,2) NOT NULL DEFAULT 0,
  scroll_depth_avg_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  active_time_sec_avg     NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- 問題行動
  rage_click_sessions     INT NOT NULL DEFAULT 0,
  dead_click_sessions     INT NOT NULL DEFAULT 0,
  quick_back_sessions     INT NOT NULL DEFAULT 0,
  excessive_scroll_sessions INT NOT NULL DEFAULT 0,
  js_error_sessions       INT NOT NULL DEFAULT 0,
  -- その他
  bot_sessions            INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clarity_daily UNIQUE (service_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_clarity_daily_service_date ON clarity_daily_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- Clarity: ページ別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS clarity_page_metrics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date             DATE NOT NULL,
  page_url                TEXT NOT NULL,
  sessions                INT NOT NULL DEFAULT 0,
  total_users             INT NOT NULL DEFAULT 0,
  scroll_depth_avg_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  active_time_sec_avg     NUMERIC(10,2) NOT NULL DEFAULT 0,
  rage_clicks             INT NOT NULL DEFAULT 0,
  dead_clicks             INT NOT NULL DEFAULT 0,
  quick_backs             INT NOT NULL DEFAULT 0,
  js_errors               INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clarity_page UNIQUE (service_id, report_date, page_url)
);

CREATE INDEX IF NOT EXISTS idx_clarity_page_service_date ON clarity_page_metrics(service_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_clarity_page_url          ON clarity_page_metrics(service_id, page_url);

-- -------------------------------------------------------
-- Clarity: デバイス別日次
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS clarity_device_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  report_date   DATE NOT NULL,
  device_type   TEXT NOT NULL,   -- Mobile / Desktop / Tablet
  browser       TEXT NOT NULL DEFAULT '(not set)',
  os            TEXT NOT NULL DEFAULT '(not set)',
  sessions      INT NOT NULL DEFAULT 0,
  total_users   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clarity_device UNIQUE (service_id, report_date, device_type, browser, os)
);

CREATE INDEX IF NOT EXISTS idx_clarity_device_service_date ON clarity_device_metrics(service_id, report_date DESC);

-- -------------------------------------------------------
-- updated_at トリガー
-- -------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_ga4_daily_updated_at
  BEFORE UPDATE ON ga4_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_clarity_daily_updated_at
  BEFORE UPDATE ON clarity_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- RLS（管理者のみ参照・更新可）
-- -------------------------------------------------------
ALTER TABLE ga4_daily_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_page_metrics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_traffic_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_event_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_device_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_geo_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarity_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarity_page_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE clarity_device_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON ga4_daily_metrics      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON ga4_page_metrics       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON ga4_traffic_sources    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON ga4_event_metrics      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON ga4_device_metrics     FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON ga4_geo_metrics        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON clarity_daily_metrics  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON clarity_page_metrics   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all" ON clarity_device_metrics FOR ALL USING (auth.role() = 'authenticated');

-- -------------------------------------------------------
-- batch_job_schedules に GA4 / Clarity を追加
-- -------------------------------------------------------
INSERT INTO batch_job_schedules (job_name, cron_expr, is_enabled, description)
VALUES
  ('ga4_collector',     '0 5 * * *', true, '毎日5:00: GA4データ収集（前日分）'),
  ('clarity_collector', '0 5 * * *', true, '毎日5:00: Clarityデータ収集（前日分）')
ON CONFLICT (job_name) DO NOTHING;

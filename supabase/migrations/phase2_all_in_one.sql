-- =============================================================
-- Phase 2: 業務管理系テーブル
-- clients / projects / services
-- =============================================================

-- クライアントテーブル
CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name   VARCHAR(255) NOT NULL,
  note          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- プロジェクトテーブル
CREATE TABLE IF NOT EXISTS projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_name   VARCHAR(255) NOT NULL,
  note           TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);

-- サービステーブル
CREATE TABLE IF NOT EXISTS services (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_type   VARCHAR(50) NOT NULL,  -- instagram / lp / x / line / google_ads / meta_ads / gbp / owned_media
  service_name   VARCHAR(255) NOT NULL,
  display_order  INT DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_service_type CHECK (
    service_type IN ('instagram','lp','x','line','google_ads','meta_ads','gbp','owned_media','summary')
  )
);

CREATE INDEX IF NOT EXISTS idx_services_project_id        ON services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_project_type      ON services(project_id, service_type);

-- Instagram連携テーブル（既存 ig_accounts と services を紐づける）
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  ig_account_ref_id     UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,  -- 既存テーブル参照
  instagram_account_id  VARCHAR(255),   -- 外部アカウントID（旧来の識別子）
  username              VARCHAR(255),
  display_name          VARCHAR(255),
  status                VARCHAR(50) DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_service_id ON instagram_accounts(service_id);

-- updated_at 自動更新トリガー（共通関数がなければ作成）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_instagram_accounts_updated_at
  BEFORE UPDATE ON instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) - 認証済みユーザーのみアクセス可
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_users_all" ON clients
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON projects
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON services
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON instagram_accounts
  FOR ALL USING (auth.role() = 'authenticated');
-- =============================================================
-- Phase 2: LP計測系テーブル
-- lp_sites / lp_users / lp_sessions / lp_page_views
-- lp_event_rules / lp_event_logs / lp_user_scores
-- lp_session_scores / lp_scoring_settings
-- =============================================================

-- LP サイト設定テーブル
CREATE TABLE IF NOT EXISTS lp_sites (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  lp_code                  VARCHAR(255) NOT NULL,
  lp_name                  VARCHAR(255) NOT NULL,
  target_url               VARCHAR(500) NOT NULL,
  session_timeout_minutes  INT NOT NULL DEFAULT 30,
  api_auth_key_hash        VARCHAR(255),   -- LP送信用認証キーのSHA-256ハッシュ
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lp_sites_lp_code UNIQUE (lp_code)
);

CREATE INDEX IF NOT EXISTS idx_lp_sites_service_id ON lp_sites(service_id);
CREATE INDEX IF NOT EXISTS idx_lp_sites_lp_code    ON lp_sites(lp_code);

-- LP ユーザーテーブル（匿名ユーザー）
CREATE TABLE IF NOT EXISTS lp_users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_site_id          UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  anonymous_user_key  VARCHAR(255) NOT NULL,
  first_visited_at    TIMESTAMPTZ NOT NULL,
  last_visited_at     TIMESTAMPTZ NOT NULL,
  visit_count         INT NOT NULL DEFAULT 1,
  total_intent_score  INT NOT NULL DEFAULT 0,
  user_temperature    VARCHAR(20) NOT NULL DEFAULT 'COLD',  -- HOT / COLD
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lp_users_site_key UNIQUE (lp_site_id, anonymous_user_key),
  CONSTRAINT chk_user_temperature CHECK (user_temperature IN ('HOT','COLD'))
);

CREATE INDEX IF NOT EXISTS idx_lp_users_site_key   ON lp_users(lp_site_id, anonymous_user_key);
CREATE INDEX IF NOT EXISTS idx_lp_users_score      ON lp_users(lp_site_id, total_intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_lp_users_last_visit ON lp_users(lp_site_id, last_visited_at DESC);

-- LP セッションテーブル
CREATE TABLE IF NOT EXISTS lp_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_user_id           UUID NOT NULL REFERENCES lp_users(id) ON DELETE CASCADE,
  lp_site_id           UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  session_no           INT NOT NULL DEFAULT 1,
  started_at           TIMESTAMPTZ NOT NULL,
  ended_at             TIMESTAMPTZ,
  last_activity_at     TIMESTAMPTZ NOT NULL,
  session_intent_score INT NOT NULL DEFAULT 0,
  interaction_count    INT NOT NULL DEFAULT 0,
  referrer_source      VARCHAR(255),
  landing_page_url     VARCHAR(500),
  exit_page_url        VARCHAR(500),
  duration_seconds     INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_sessions_user_started    ON lp_sessions(lp_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_sessions_site_started    ON lp_sessions(lp_site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_sessions_referrer        ON lp_sessions(referrer_source, started_at DESC);

-- LP ページビューテーブル
CREATE TABLE IF NOT EXISTS lp_page_views (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_session_id     UUID NOT NULL REFERENCES lp_sessions(id) ON DELETE CASCADE,
  lp_site_id        UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  occurred_at       TIMESTAMPTZ NOT NULL,
  page_url          VARCHAR(500) NOT NULL,
  page_path         VARCHAR(255),
  page_title        VARCHAR(255),
  scroll_percent_max INT,
  stay_seconds      INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_page_views_session     ON lp_page_views(lp_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lp_page_views_site_path   ON lp_page_views(lp_site_id, page_path, occurred_at DESC);

-- LP イベントルールテーブル
CREATE TABLE IF NOT EXISTS lp_event_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_site_id    UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  event_id      VARCHAR(255) NOT NULL,
  event_name    VARCHAR(255) NOT NULL,
  intent_type   VARCHAR(100) NOT NULL DEFAULT '',
  intent_score  INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lp_event_rules_site_event UNIQUE (lp_site_id, event_id),
  CONSTRAINT chk_intent_score CHECK (intent_score >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lp_event_rules_site ON lp_event_rules(lp_site_id);

-- LP イベントログテーブル
CREATE TABLE IF NOT EXISTS lp_event_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_site_id            UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  lp_user_id            UUID NOT NULL REFERENCES lp_users(id) ON DELETE CASCADE,
  lp_session_id         UUID NOT NULL REFERENCES lp_sessions(id) ON DELETE CASCADE,
  event_rule_id         UUID REFERENCES lp_event_rules(id) ON DELETE SET NULL,
  raw_event_id          VARCHAR(255) NOT NULL,
  event_name_snapshot   VARCHAR(255),
  intent_score_snapshot INT NOT NULL DEFAULT 0,
  page_url              VARCHAR(500),
  referrer_source       VARCHAR(255),
  scroll_percent        INT,
  meta_json             JSONB DEFAULT '{}',
  occurred_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_event_logs_session     ON lp_event_logs(lp_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lp_event_logs_user        ON lp_event_logs(lp_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lp_event_logs_site_event  ON lp_event_logs(lp_site_id, raw_event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_event_logs_rule        ON lp_event_logs(event_rule_id, occurred_at DESC);

-- LP ユーザースコアスナップショット
CREATE TABLE IF NOT EXISTS lp_user_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_user_id          UUID NOT NULL REFERENCES lp_users(id) ON DELETE CASCADE,
  total_intent_score  INT NOT NULL,
  hot_threshold       INT NOT NULL,
  user_temperature    VARCHAR(20) NOT NULL,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_user_scores_user ON lp_user_scores(lp_user_id, calculated_at DESC);

-- LP セッションスコアスナップショット
CREATE TABLE IF NOT EXISTS lp_session_scores (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_session_id        UUID NOT NULL REFERENCES lp_sessions(id) ON DELETE CASCADE,
  session_intent_score INT NOT NULL,
  interaction_count    INT NOT NULL,
  calculated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_session_scores_session ON lp_session_scores(lp_session_id, calculated_at DESC);

-- LP スコアリング設定テーブル（ホット/コールド閾値管理）
CREATE TABLE IF NOT EXISTS lp_scoring_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_site_id     UUID NOT NULL REFERENCES lp_sites(id) ON DELETE CASCADE,
  hot_threshold  INT NOT NULL DEFAULT 100,
  cold_threshold INT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_scoring_settings_site ON lp_scoring_settings(lp_site_id, is_active);

-- Triggers
CREATE OR REPLACE TRIGGER trg_lp_sites_updated_at
  BEFORE UPDATE ON lp_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_lp_users_updated_at
  BEFORE UPDATE ON lp_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_lp_sessions_updated_at
  BEFORE UPDATE ON lp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_lp_event_rules_updated_at
  BEFORE UPDATE ON lp_event_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_lp_scoring_settings_updated_at
  BEFORE UPDATE ON lp_scoring_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE lp_sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_page_views       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_event_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_event_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_user_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_session_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_scoring_settings ENABLE ROW LEVEL SECURITY;

-- 管理画面向け（認証済み）
CREATE POLICY "authenticated_users_all" ON lp_sites            FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_users            FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_sessions         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_page_views       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_event_rules      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_event_logs       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_user_scores      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_session_scores   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_users_all" ON lp_scoring_settings FOR ALL USING (auth.role() = 'authenticated');

-- LP受信API（anon キー経由）: lp_users / lp_sessions / lp_page_views / lp_event_logs への書き込み許可
CREATE POLICY "anon_insert_lp_users"      ON lp_users      FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_lp_users"      ON lp_users      FOR UPDATE USING (true);
CREATE POLICY "anon_select_lp_users"      ON lp_users      FOR SELECT USING (true);
CREATE POLICY "anon_insert_lp_sessions"   ON lp_sessions   FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_lp_sessions"   ON lp_sessions   FOR UPDATE USING (true);
CREATE POLICY "anon_select_lp_sessions"   ON lp_sessions   FOR SELECT USING (true);
CREATE POLICY "anon_insert_lp_page_views" ON lp_page_views FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert_lp_event_logs" ON lp_event_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_select_lp_sites"      ON lp_sites      FOR SELECT USING (true);
CREATE POLICY "anon_select_lp_event_rules" ON lp_event_rules FOR SELECT USING (true);
CREATE POLICY "anon_select_lp_scoring_settings" ON lp_scoring_settings FOR SELECT USING (true);
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

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

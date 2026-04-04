-- ================================================
-- Instagram分析システム 初期スキーマ
-- ================================================

-- UUID生成拡張
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================
-- 1. 認証・ユーザー管理
-- ================================================

CREATE TABLE IF NOT EXISTS app_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 2. アカウント管理
-- ================================================

CREATE TABLE IF NOT EXISTS ig_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_account_id  TEXT NOT NULL UNIQUE,
  facebook_page_id     TEXT,
  username             TEXT NOT NULL,
  account_name         TEXT,
  account_type         TEXT NOT NULL DEFAULT 'BUSINESS' CHECK (account_type IN ('BUSINESS', 'CREATOR')),
  biography            TEXT,
  profile_picture_url  TEXT,
  website              TEXT,
  followers_count      INTEGER,
  follows_count        INTEGER,
  media_count          INTEGER,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disconnected')),
  display_order        INTEGER NOT NULL DEFAULT 0,
  connected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ig_account_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  token_type       TEXT NOT NULL DEFAULT 'long_lived' CHECK (token_type IN ('short_lived', 'long_lived')),
  access_token_enc TEXT NOT NULL,
  expires_at       TIMESTAMPTZ,
  scopes           TEXT[],
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 3. Raw層 (APIレスポンス原本)
-- ================================================

CREATE TABLE IF NOT EXISTS api_call_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  endpoint         TEXT NOT NULL,
  request_params   JSONB,
  response_body    JSONB,
  http_status      INTEGER,
  rate_usage       JSONB,
  batch_job_id     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_call_logs_account_id ON api_call_logs(account_id);
CREATE INDEX idx_api_call_logs_created_at ON api_call_logs(created_at);

-- ================================================
-- 4. Fact層
-- ================================================

CREATE TABLE IF NOT EXISTS ig_media (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  platform_media_id   TEXT NOT NULL,
  media_type          TEXT NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  media_product_type  TEXT CHECK (media_product_type IN ('FEED', 'REELS', 'STORY', 'AD')),
  caption             TEXT,
  permalink           TEXT,
  thumbnail_url       TEXT,
  media_url           TEXT,
  children_json       JSONB,
  posted_at           TIMESTAMPTZ NOT NULL,
  is_deleted          BOOLEAN NOT NULL DEFAULT false,
  is_comment_enabled  BOOLEAN,
  shortcode           TEXT,
  inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, platform_media_id)
);

CREATE INDEX idx_ig_media_account_id ON ig_media(account_id);
CREATE INDEX idx_ig_media_posted_at ON ig_media(posted_at DESC);

CREATE TABLE IF NOT EXISTS ig_media_snapshot (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id        UUID NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  followers_count INTEGER,
  likes_count     INTEGER,
  comments_count  INTEGER,
  reach           INTEGER,
  impressions     INTEGER,
  saved           INTEGER,
  shares          INTEGER,
  video_views     INTEGER
);

CREATE INDEX idx_ig_media_snapshot_media_id ON ig_media_snapshot(media_id);
CREATE INDEX idx_ig_media_snapshot_snapshot_at ON ig_media_snapshot(snapshot_at DESC);

CREATE TABLE IF NOT EXISTS ig_media_insight_fact (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     UUID NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
  metric_code  TEXT NOT NULL,
  period_code  TEXT NOT NULL DEFAULT 'lifetime',
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  value        BIGINT
);

CREATE UNIQUE INDEX idx_ig_media_insight_unique ON ig_media_insight_fact(media_id, metric_code, period_code, snapshot_at);
CREATE INDEX idx_ig_media_insight_media_id ON ig_media_insight_fact(media_id);

CREATE TABLE IF NOT EXISTS ig_account_insight_fact (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  metric_code      TEXT NOT NULL,
  dimension_code   TEXT,
  dimension_value  TEXT,
  period_code      TEXT NOT NULL,
  value_date       DATE NOT NULL,
  value            BIGINT,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ig_account_insight_unique ON ig_account_insight_fact(account_id, metric_code, period_code, value_date, COALESCE(dimension_code, ''), COALESCE(dimension_value, ''));
CREATE INDEX idx_ig_account_insight_account_date ON ig_account_insight_fact(account_id, value_date DESC);

CREATE TABLE IF NOT EXISTS ig_story_insight_fact (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id     UUID NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
  metric_code  TEXT NOT NULL,
  value        BIGINT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ig_profile_action_fact (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,
  action_date   DATE NOT NULL,
  count         BIGINT NOT NULL DEFAULT 0,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ig_comment_fact (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id            UUID NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
  platform_comment_id TEXT NOT NULL UNIQUE,
  username            TEXT,
  text                TEXT,
  replied_to_id       UUID REFERENCES ig_comment_fact(id),
  is_hidden           BOOLEAN NOT NULL DEFAULT false,
  commented_at        TIMESTAMPTZ NOT NULL,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 5. KPI
-- ================================================

CREATE TABLE IF NOT EXISTS kpi_master (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_code             TEXT NOT NULL UNIQUE,
  kpi_name             TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN ('engagement', 'reach', 'growth', 'content', 'conversion')),
  capability_type      TEXT NOT NULL CHECK (capability_type IN ('DIRECT_API', 'DERIVED', 'MANUAL_INPUT', 'UNAVAILABLE_NOW')),
  formula_type         TEXT CHECK (formula_type IN ('ratio', 'delta', 'sum', 'avg', 'custom')),
  numerator_source     TEXT,
  denominator_source   TEXT,
  formula_expression   TEXT,
  subject_level        TEXT NOT NULL CHECK (subject_level IN ('media', 'account_daily', 'account_weekly', 'account_monthly')),
  media_scope          TEXT,
  unit_type            TEXT NOT NULL DEFAULT 'count' CHECK (unit_type IN ('count', 'rate', 'percent', 'index')),
  higher_is_better     BOOLEAN NOT NULL DEFAULT true,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  display_order        INTEGER NOT NULL DEFAULT 0,
  description          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id          UUID NOT NULL REFERENCES kpi_master(id) ON DELETE CASCADE,
  depends_on_kpi  UUID NOT NULL REFERENCES kpi_master(id) ON DELETE CASCADE,
  dependency_role TEXT,
  UNIQUE(kpi_id, depends_on_kpi)
);

CREATE TABLE IF NOT EXISTS kpi_result (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  media_id        UUID REFERENCES ig_media(id) ON DELETE SET NULL,
  kpi_id          UUID NOT NULL REFERENCES kpi_master(id) ON DELETE CASCADE,
  grain           TEXT NOT NULL CHECK (grain IN ('hourly', 'daily', 'weekly', 'monthly', 'lifetime')),
  subject_type    TEXT NOT NULL CHECK (subject_type IN ('media', 'account')),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  actual_value    NUMERIC,
  source_status   TEXT NOT NULL DEFAULT 'complete' CHECK (source_status IN ('complete', 'partial', 'waiting_data', 'unsupported', 'manual_required')),
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  calc_version    TEXT NOT NULL DEFAULT '1.0'
);

CREATE INDEX idx_kpi_result_account_kpi ON kpi_result(account_id, kpi_id, grain);
CREATE INDEX idx_kpi_result_period ON kpi_result(period_start DESC);

CREATE TABLE IF NOT EXISTS kpi_target (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  kpi_id              UUID NOT NULL REFERENCES kpi_master(id) ON DELETE CASCADE,
  target_name         TEXT,
  grain               TEXT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE,
  target_value        NUMERIC NOT NULL,
  warning_threshold   NUMERIC,
  critical_threshold  NUMERIC,
  scope_json          JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_progress (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  kpi_result_id     UUID REFERENCES kpi_result(id) ON DELETE SET NULL,
  kpi_target_id     UUID REFERENCES kpi_target(id) ON DELETE SET NULL,
  actual_value      NUMERIC,
  target_value      NUMERIC,
  gap_value         NUMERIC,
  achievement_rate  NUMERIC,
  status            TEXT NOT NULL CHECK (status IN ('achieved', 'on_track', 'warning', 'critical', 'insufficient_data')),
  evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 6. 設定
-- ================================================

CREATE TABLE IF NOT EXISTS account_kpi_settings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                   UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE UNIQUE,
  target_followers             INTEGER,
  target_engagement_rate       NUMERIC,
  target_reach_per_post        INTEGER,
  target_saves_per_post        INTEGER,
  target_posts_per_week        NUMERIC,
  target_monthly_follower_gain INTEGER,
  custom_kpi_enabled           JSONB DEFAULT '{}',
  kpi_targets_json             JSONB DEFAULT '{}',
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_prompt_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_type           TEXT NOT NULL CHECK (prompt_type IN ('post_analysis', 'post_comparison', 'account_weekly', 'account_monthly')),
  prompt_text           TEXT NOT NULL,
  algorithm_info        TEXT,
  algorithm_fetched_at  TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  version               INTEGER NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_analysis_prompt_type ON analysis_prompt_settings(prompt_type) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS account_strategy_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE UNIQUE,
  strategy_text  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 7. AI分析結果
-- ================================================

CREATE TABLE IF NOT EXISTS ai_analysis_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  analysis_type         TEXT NOT NULL,
  media_ids             UUID[],
  analysis_result       TEXT NOT NULL,
  model_used            TEXT,
  tokens_used           INTEGER,
  target_period_start   DATE,
  target_period_end     DATE,
  triggered_by          TEXT NOT NULL DEFAULT 'user' CHECK (triggered_by IN ('user', 'batch_weekly', 'batch_monthly')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_results_account ON ai_analysis_results(account_id, created_at DESC);

-- ================================================
-- 8. バッチ管理
-- ================================================

CREATE TABLE IF NOT EXISTS batch_job_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name            TEXT NOT NULL,
  account_id          UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  records_processed   INTEGER NOT NULL DEFAULT 0,
  records_failed      INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  duration_ms         INTEGER
);

CREATE INDEX idx_batch_logs_job_name ON batch_job_logs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS batch_job_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name       TEXT NOT NULL UNIQUE,
  cron_expr      TEXT NOT NULL,
  is_enabled     BOOLEAN NOT NULL DEFAULT true,
  last_run_at    TIMESTAMPTZ,
  next_run_at    TIMESTAMPTZ,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================
-- 9. RLS (Row Level Security) 設定
-- ================================================

-- 全テーブルでRLSを有効化（シングルユーザー想定のためauthenticatedロールに全権限）
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_account_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_media_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_media_insight_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_account_insight_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_story_insight_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_profile_action_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_comment_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_kpi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_prompt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_strategy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs ENABLE ROW LEVEL SECURITY;

-- authenticatedユーザーに全アクセス許可
CREATE POLICY "authenticated_all" ON app_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_account_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_media_snapshot FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_media_insight_fact FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_account_insight_fact FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_story_insight_fact FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_profile_action_fact FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ig_comment_fact FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_dependencies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_result FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_target FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON kpi_progress FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON account_kpi_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON analysis_prompt_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON account_strategy_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON ai_analysis_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON batch_job_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON batch_job_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON api_call_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- service_roleには全テーブルアクセス許可（バッチ処理用）
CREATE POLICY "service_role_all" ON ig_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_account_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_media FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_media_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_media_insight_fact FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_account_insight_fact FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_story_insight_fact FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_profile_action_fact FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ig_comment_fact FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON kpi_master FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON kpi_result FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON kpi_target FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON kpi_progress FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON account_kpi_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON analysis_prompt_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON account_strategy_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ai_analysis_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON batch_job_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON batch_job_schedules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON api_call_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

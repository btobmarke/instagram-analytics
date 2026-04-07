-- ============================================================
-- Migration 011: GBP（Google Business Profile）スキーマ
--   gbp_credentials  … クライアント単位のOAuth認証情報
--   gbp_sites        … GBPサービス単位のロケーション設定（lp_sitesと同形）
--   gbp_performance_daily … 日次パフォーマンス指標
--   gbp_reviews      … レビュースナップショット
--   gbp_batch_runs   … バッチ実行ログ
-- ============================================================

-- 1. gbp_credentials（クライアント単位のOAuth認証情報）
CREATE TABLE IF NOT EXISTS gbp_credentials (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- OAuth クライアント情報（暗号化）… 画面から登録
  oauth_client_id_enc     TEXT NOT NULL,
  oauth_client_secret_enc TEXT NOT NULL,
  -- リフレッシュトークン（OAuth完了後に書き込み。未連携時はNULL）
  refresh_token_enc       TEXT,
  -- 同意済みスコープ（カンマ区切り）
  scopes                  TEXT,
  -- 認証ステータス: pending=OAuth未完了, active=連携済, revoked=解除済, error=要再連携
  auth_status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (auth_status IN ('pending', 'active', 'revoked', 'error')),
  -- Google アカウント情報（表示用）
  google_account_email    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_credentials_client_id ON gbp_credentials(client_id);

CREATE OR REPLACE TRIGGER trg_gbp_credentials_updated_at
  BEFORE UPDATE ON gbp_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. gbp_sites（GBPサービス単位のロケーション設定）
CREATE TABLE IF NOT EXISTS gbp_sites (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  -- GBP ロケーション resource name（例: locations/123456789）
  gbp_location_name     TEXT NOT NULL,
  -- GBP 上の店舗名（API同期で更新）
  gbp_title             TEXT,
  -- 有効フラグ
  is_active             BOOLEAN NOT NULL DEFAULT true,
  -- 最終同期日時
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_sites_service_id ON gbp_sites(service_id);

CREATE OR REPLACE TRIGGER trg_gbp_sites_updated_at
  BEFORE UPDATE ON gbp_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. gbp_batch_runs（バッチ実行ログ）
CREATE TABLE IF NOT EXISTS gbp_batch_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLの場合は全クライアント対象
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  trigger       VARCHAR(50) DEFAULT 'vercel_cron',
  target_date   DATE,
  days          INT DEFAULT 7,
  status        VARCHAR(20) NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'success', 'partial', 'failed')),
  error_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_gbp_batch_runs_started_at ON gbp_batch_runs(started_at DESC);

-- 4. gbp_performance_daily（日次パフォーマンス指標）
CREATE TABLE IF NOT EXISTS gbp_performance_daily (
  id                                     BIGSERIAL PRIMARY KEY,
  gbp_site_id                            UUID NOT NULL REFERENCES gbp_sites(id) ON DELETE CASCADE,
  date                                   DATE NOT NULL,
  -- インプレッション系
  business_impressions_desktop_search    BIGINT,
  business_impressions_mobile_search     BIGINT,
  business_impressions_desktop_maps      BIGINT,
  business_impressions_mobile_maps       BIGINT,
  -- アクション系
  business_conversations                 BIGINT,
  business_direction_requests            BIGINT,
  call_clicks                            BIGINT,
  website_clicks                         BIGINT,
  -- 予約・飲食系
  business_bookings                      BIGINT,
  business_food_orders                   BIGINT,
  business_food_menu_clicks              BIGINT,
  -- デバッグ用生データ
  raw_payload                            JSONB,
  updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gbp_site_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_performance_site_date
  ON gbp_performance_daily(gbp_site_id, date DESC);

CREATE OR REPLACE TRIGGER trg_gbp_performance_updated_at
  BEFORE UPDATE ON gbp_performance_daily
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. gbp_reviews（レビュースナップショット）
CREATE TABLE IF NOT EXISTS gbp_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gbp_site_id      UUID NOT NULL REFERENCES gbp_sites(id) ON DELETE CASCADE,
  batch_run_id     UUID REFERENCES gbp_batch_runs(id) ON DELETE SET NULL,
  -- Google 側レビューID（一意キー）
  review_id        TEXT NOT NULL,
  -- 評価・本文
  star_rating      VARCHAR(20),  -- ONE/TWO/THREE/FOUR/FIVE
  comment          TEXT,
  reviewer_name    TEXT,
  reviewer_photo_url TEXT,
  -- 日時
  create_time      TIMESTAMPTZ,
  update_time      TIMESTAMPTZ,
  -- 返信
  reply_comment    TEXT,
  reply_update_time TIMESTAMPTZ,
  -- 収集日時
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gbp_site_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_site_id
  ON gbp_reviews(gbp_site_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_batch_run_id
  ON gbp_reviews(batch_run_id);

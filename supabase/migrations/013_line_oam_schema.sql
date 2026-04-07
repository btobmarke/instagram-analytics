-- ============================================================
-- Migration 013: LINE OAM スキーマ
--   line_oam_url_templates  … URLテンプレート（システム設定）
--   line_oam_sessions       … 暗号化 storage_state（クライアント単位）
--   line_oam_service_configs … bot_id 設定（サービス単位）
--   line_oam_rewardcards    … リワードカード設定（サービス単位・複数可）
--   line_oam_friends_daily  … フレンド数日次データ
--   line_oam_friends_attr   … フレンド属性スナップショット
--   line_oam_rewardcard_txns … ポイント取引ログ
--   line_oam_shopcard_point … ポイント分布
--   line_oam_shopcard_status … ショップカード集計
--   line_oam_batch_runs     … バッチ実行ログ
-- ============================================================

-- 1. URLテンプレート（システム全体設定）
CREATE TABLE IF NOT EXISTS line_oam_url_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  csv_type     VARCHAR(30) NOT NULL UNIQUE,
  url_template TEXT NOT NULL,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- デフォルトURLテンプレートを挿入
INSERT INTO line_oam_url_templates (csv_type, url_template, description) VALUES
  ('base_url',
   'https://manager.line.biz',
   'LINE OAM ベースURL'),
  ('contacts',
   '{base_url}/api/bots/{bot_id}/insight/contacts.csv?fromDate={from_yyyymmdd}&toDate={to_yyyymmdd}',
   'フレンド数（日次）'),
  ('friends_attr',
   '{base_url}/api/bots/{bot_id}/insight/demographic/v2/age.csv',
   'フレンド属性（性別・年齢）'),
  ('shopcard_status',
   '{base_url}/api/bots/{bot_id}/oashopcard/{rewardcard_id}/insight/usageStatsCsv?date={date_str}',
   'ショップカード・ステータス'),
  ('shopcard_point',
   '{base_url}/api/bots/{bot_id}/oashopcard/{rewardcard_id}/insight/userDistributionByPointCsv?date={date_str}',
   'ショップカード・ポイント分布'),
  ('rewardcard_txns',
   '{base_url}/api/bots/{bot_id}/oashopcard/{rewardcard_id}/usageHistory/pointHistoriesCsv?fromDate={from_ms}&toDate={to_ms}&lang=ja&utcOffset=540',
   'リワードカード・ポイント取引履歴')
ON CONFLICT (csv_type) DO NOTHING;

CREATE OR REPLACE TRIGGER trg_line_oam_url_templates_updated_at
  BEFORE UPDATE ON line_oam_url_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. セッション（クライアント単位・1クライアント1セッション）
CREATE TABLE IF NOT EXISTS line_oam_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- 暗号化フォーマット（仕様書 §3 と同一スキーマ）
  format_version       INT NOT NULL DEFAULT 1,
  cipher               VARCHAR(20) NOT NULL DEFAULT 'AES-256-GCM',
  kdf                  JSONB NOT NULL,       -- { name, hash, iterations, salt_b64 }
  nonce_b64            TEXT NOT NULL,
  ciphertext_b64       TEXT NOT NULL,        -- AES-256-GCM 暗号文 + 16byte 認証タグ
  -- 無人バッチ用: KEK(AES-256-CBC) で包んだパスフレーズ
  encrypted_passphrase TEXT,
  label                TEXT,
  status               VARCHAR(10) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'revoked')),
  created_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_oam_sessions_client_id ON line_oam_sessions(client_id);

CREATE OR REPLACE TRIGGER trg_line_oam_sessions_updated_at
  BEFORE UPDATE ON line_oam_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. サービス設定（サービス単位）
CREATE TABLE IF NOT EXISTS line_oam_service_configs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  bot_id     TEXT NOT NULL,   -- e.g. @012pyxjw
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_line_oam_service_configs_updated_at
  BEFORE UPDATE ON line_oam_service_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. リワードカード設定（サービス単位・複数可）
CREATE TABLE IF NOT EXISTS line_oam_rewardcards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  rewardcard_id TEXT NOT NULL,   -- LINE OAM が発行するリワードカードID
  name          TEXT,            -- 管理用ラベル
  start_date    DATE,            -- ポイント履歴取得の起算日
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, rewardcard_id)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_rewardcards_service_id ON line_oam_rewardcards(service_id);

CREATE OR REPLACE TRIGGER trg_line_oam_rewardcards_updated_at
  BEFORE UPDATE ON line_oam_rewardcards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. フレンド数日次データ
CREATE TABLE IF NOT EXISTS line_oam_friends_daily (
  id             BIGSERIAL PRIMARY KEY,
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  contacts       BIGINT,
  target_reaches BIGINT,
  blocks         BIGINT,
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, date)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_friends_daily_service_date
  ON line_oam_friends_daily(service_id, date DESC);

-- 6. フレンド属性スナップショット（性別×年齢）
CREATE TABLE IF NOT EXISTS line_oam_friends_attr (
  id           BIGSERIAL PRIMARY KEY,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  gender       VARCHAR(10),
  age          VARCHAR(20),
  percentage   NUMERIC(5,1),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, date, gender, age)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_friends_attr_service_date
  ON line_oam_friends_attr(service_id, date DESC);

-- 7. リワードカード・ポイント取引ログ（全期間累積・UPSERT）
CREATE TABLE IF NOT EXISTS line_oam_rewardcard_txns (
  id                 BIGSERIAL PRIMARY KEY,
  line_rewardcard_id UUID NOT NULL REFERENCES line_oam_rewardcards(id) ON DELETE CASCADE,
  txn_datetime       TIMESTAMPTZ NOT NULL,
  customer_id        TEXT NOT NULL,
  point_type         TEXT,
  points             INT,
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(line_rewardcard_id, txn_datetime, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_rewardcard_txns_card_datetime
  ON line_oam_rewardcard_txns(line_rewardcard_id, txn_datetime DESC);

-- 8. ショップカード・ポイント分布
CREATE TABLE IF NOT EXISTS line_oam_shopcard_point (
  id                 BIGSERIAL PRIMARY KEY,
  line_rewardcard_id UUID NOT NULL REFERENCES line_oam_rewardcards(id) ON DELETE CASCADE,
  date               DATE NOT NULL,
  point              INT NOT NULL,
  users              INT,
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(line_rewardcard_id, date, point)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_shopcard_point_card_date
  ON line_oam_shopcard_point(line_rewardcard_id, date DESC);

-- 9. ショップカード・ステータス
CREATE TABLE IF NOT EXISTS line_oam_shopcard_status (
  id                      BIGSERIAL PRIMARY KEY,
  line_rewardcard_id      UUID NOT NULL REFERENCES line_oam_rewardcards(id) ON DELETE CASCADE,
  date                    DATE NOT NULL,
  name                    TEXT NOT NULL,
  valid_cards             INT,
  issued_cards            INT,
  store_visit_points      INT,
  welcome_bonuses_awarded INT,
  expired_points          INT,
  vouchers_awarded        INT,
  vouchers_used           INT,
  deleted                 BOOLEAN,
  collected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(line_rewardcard_id, date, name)
);

CREATE INDEX IF NOT EXISTS idx_line_oam_shopcard_status_card_date
  ON line_oam_shopcard_status(line_rewardcard_id, date DESC);

-- 10. バッチ実行ログ
CREATE TABLE IF NOT EXISTS line_oam_batch_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  trigger       VARCHAR(50) DEFAULT 'vercel_cron',
  target_date   DATE,
  status        VARCHAR(20) NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'success', 'partial', 'failed')),
  error_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_line_oam_batch_runs_started_at
  ON line_oam_batch_runs(started_at DESC);

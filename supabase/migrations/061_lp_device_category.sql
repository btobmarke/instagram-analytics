-- LP 計測: 匿名ユーザー・セッションに UA と端末カテゴリを保存（identify / session/start）

ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS device_category VARCHAR(20) NOT NULL DEFAULT 'unknown';

ALTER TABLE lp_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS device_category VARCHAR(20) NOT NULL DEFAULT 'unknown';

ALTER TABLE lp_users DROP CONSTRAINT IF EXISTS chk_lp_users_device_category;
ALTER TABLE lp_users
  ADD CONSTRAINT chk_lp_users_device_category
  CHECK (device_category IN ('mobile', 'tablet', 'desktop', 'unknown'));

ALTER TABLE lp_sessions DROP CONSTRAINT IF EXISTS chk_lp_sessions_device_category;
ALTER TABLE lp_sessions
  ADD CONSTRAINT chk_lp_sessions_device_category
  CHECK (device_category IN ('mobile', 'tablet', 'desktop', 'unknown'));

COMMENT ON COLUMN lp_users.user_agent IS 'User-Agent 生文字列（最新訪問時に identify で更新）';
COMMENT ON COLUMN lp_users.device_category IS 'UA から推定: mobile | tablet | desktop | unknown';
COMMENT ON COLUMN lp_sessions.user_agent IS 'セッション開始時点の User-Agent';
COMMENT ON COLUMN lp_sessions.device_category IS 'セッション開始時点の端末カテゴリ';

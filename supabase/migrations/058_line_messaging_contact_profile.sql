-- LINE Get profile API で取得する追加フィールド
ALTER TABLE line_messaging_contacts
  ADD COLUMN IF NOT EXISTS line_status_message TEXT,
  ADD COLUMN IF NOT EXISTS line_language TEXT,
  ADD COLUMN IF NOT EXISTS profile_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN line_messaging_contacts.line_status_message IS 'GET /v2/bot/profile の statusMessage';
COMMENT ON COLUMN line_messaging_contacts.line_language IS 'GET /v2/bot/profile の language';
COMMENT ON COLUMN line_messaging_contacts.profile_fetched_at IS 'プロフィール API 最終取得成功時刻';

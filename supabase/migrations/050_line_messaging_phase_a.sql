-- ============================================================
-- LINE Messaging API Phase A: 認証情報・Webhook 冪等・友だち状態
-- ============================================================

-- サービス単位の Messaging API 認証（channel secret / token はアプリ層で暗号化して格納）
CREATE TABLE IF NOT EXISTS line_messaging_service_credentials (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id                UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  channel_secret_enc        TEXT NOT NULL,
  channel_access_token_enc  TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_creds_service
  ON line_messaging_service_credentials (service_id);

COMMENT ON TABLE line_messaging_service_credentials IS
  'LINE Messaging API の channel secret と long-lived channel access token（*_enc は AES-256-CBC、アプリの ENCRYPTION_KEY で復号）';

CREATE TRIGGER trg_line_messaging_service_credentials_updated_at
  BEFORE UPDATE ON line_messaging_service_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_service_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_service_credentials"
  ON line_messaging_service_credentials FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_service_credentials"
  ON line_messaging_service_credentials FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Webhook 配送の冪等キー（deliveryId または raw body hash）
CREATE TABLE IF NOT EXISTS line_messaging_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  dedupe_key   TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_webhook_events_service
  ON line_messaging_webhook_events (service_id);

COMMENT ON TABLE line_messaging_webhook_events IS
  'LINE Webhook の冪等処理用。同一 (service_id, dedupe_key) の再送は無視する。';

ALTER TABLE line_messaging_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full line_messaging_webhook_events"
  ON line_messaging_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 友だち状態（unfollow 時に false）
ALTER TABLE line_messaging_contacts
  ADD COLUMN IF NOT EXISTS is_followed BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN line_messaging_contacts.is_followed IS '友だち関係が有効か（unfollow で false）';

-- Webhook 冪等: 初回のみ true、重複キーなら false（再送は処理スキップ可）
CREATE OR REPLACE FUNCTION line_messaging_claim_webhook_event(
  p_service_id UUID,
  p_dedupe_key TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO line_messaging_webhook_events (service_id, dedupe_key)
  VALUES (p_service_id, p_dedupe_key);
  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END;
$$;

COMMENT ON FUNCTION line_messaging_claim_webhook_event IS
  'LINE Webhook の配送単位で冪等キーを予約する。true=新規、false=既処理の再送';

GRANT EXECUTE ON FUNCTION line_messaging_claim_webhook_event(UUID, TEXT) TO service_role;

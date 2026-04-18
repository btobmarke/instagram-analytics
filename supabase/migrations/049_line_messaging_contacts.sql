-- ============================================================
-- LINE MA（Messaging API）由来の友だち / ユーザー行
-- - 同一チャネルは既存の services.id（service_type = line）と line_oam_service_configs と共有
-- - line_oam_rewardcard_txns.customer_id と突合する場合は、通常 line_user_id と同一文字列（要実データ確認）
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  line_user_id      TEXT NOT NULL,
  display_name      TEXT,
  picture_url       TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_contacts_service
  ON line_messaging_contacts (service_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_contacts_line_user
  ON line_messaging_contacts (line_user_id);

COMMENT ON TABLE line_messaging_contacts IS
  'LINE Messaging API の userId を保持。OAM 付与ログとの突合は line_user_id と line_oam_rewardcard_txns.customer_id（実データで一致確認すること）。';

COMMENT ON COLUMN line_messaging_contacts.line_user_id IS 'Messaging API destination.userId';
COMMENT ON COLUMN line_messaging_contacts.first_seen_at IS '初回観測（友だち追加等）';
COMMENT ON COLUMN line_messaging_contacts.last_interaction_at IS '最終 Webhook / プロフィール取得など';

CREATE TRIGGER trg_line_messaging_contacts_updated_at
  BEFORE UPDATE ON line_messaging_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_contacts"
  ON line_messaging_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_contacts"
  ON line_messaging_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

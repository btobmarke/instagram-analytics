-- ============================================================
-- LINE Messaging Phase C: CRM（タグ・属性・セグメント・運用）
-- ============================================================

ALTER TABLE line_messaging_contacts
  ADD COLUMN IF NOT EXISTS lead_status TEXT,
  ADD COLUMN IF NOT EXISTS ops_memo TEXT,
  ADD COLUMN IF NOT EXISTS assignee_app_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN line_messaging_contacts.lead_status IS '対応ステータス（自由テキスト）';
COMMENT ON COLUMN line_messaging_contacts.ops_memo IS '運用メモ';
COMMENT ON COLUMN line_messaging_contacts.assignee_app_user_id IS '担当（app_users.id）';

CREATE INDEX IF NOT EXISTS idx_line_messaging_contacts_assignee
  ON line_messaging_contacts (assignee_app_user_id);

-- タグ（サービススコープ）
CREATE TABLE IF NOT EXISTS line_messaging_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_tags_service
  ON line_messaging_tags (service_id);

CREATE TRIGGER trg_line_messaging_tags_updated_at
  BEFORE UPDATE ON line_messaging_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_tags"
  ON line_messaging_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_tags"
  ON line_messaging_tags FOR ALL TO service_role USING (true) WITH CHECK (true);

-- コンタクト ⇔ タグ（多対多）
CREATE TABLE IF NOT EXISTS line_messaging_contact_tags (
  contact_id UUID NOT NULL REFERENCES line_messaging_contacts(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES line_messaging_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_contact_tags_tag
  ON line_messaging_contact_tags (tag_id);

ALTER TABLE line_messaging_contact_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_contact_tags"
  ON line_messaging_contact_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_contact_tags"
  ON line_messaging_contact_tags FOR ALL TO service_role USING (true) WITH CHECK (true);

-- カスタム属性定義
CREATE TABLE IF NOT EXISTS line_messaging_attribute_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  label          TEXT NOT NULL,
  value_type     TEXT NOT NULL
                 CHECK (value_type IN ('text', 'number', 'select')),
  select_options JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, code)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_attr_defs_service
  ON line_messaging_attribute_definitions (service_id);

CREATE TRIGGER trg_line_messaging_attribute_definitions_updated_at
  BEFORE UPDATE ON line_messaging_attribute_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_attribute_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_attribute_definitions"
  ON line_messaging_attribute_definitions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_attribute_definitions"
  ON line_messaging_attribute_definitions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- コンタクト属性値（1 定義あたり 1 値）
CREATE TABLE IF NOT EXISTS line_messaging_contact_attribute_values (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID NOT NULL REFERENCES line_messaging_contacts(id) ON DELETE CASCADE,
  definition_id  UUID NOT NULL REFERENCES line_messaging_attribute_definitions(id) ON DELETE CASCADE,
  value_text     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, definition_id)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_contact_attr_vals_contact
  ON line_messaging_contact_attribute_values (contact_id);

CREATE INDEX IF NOT EXISTS idx_line_messaging_contact_attr_vals_def
  ON line_messaging_contact_attribute_values (definition_id);

CREATE TRIGGER trg_line_messaging_contact_attribute_values_updated_at
  BEFORE UPDATE ON line_messaging_contact_attribute_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_contact_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_contact_attribute_values"
  ON line_messaging_contact_attribute_values FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_contact_attribute_values"
  ON line_messaging_contact_attribute_values FOR ALL TO service_role USING (true) WITH CHECK (true);

-- セグメント定義（JSON はアプリで解釈）
CREATE TABLE IF NOT EXISTS line_messaging_segments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  definition   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_segments_service
  ON line_messaging_segments (service_id);

CREATE TRIGGER trg_line_messaging_segments_updated_at
  BEFORE UPDATE ON line_messaging_segments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_segments"
  ON line_messaging_segments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_segments"
  ON line_messaging_segments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 一斉配信: セグメント由来
ALTER TABLE line_messaging_broadcast_jobs
  ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES line_messaging_segments(id) ON DELETE SET NULL;

COMMENT ON COLUMN line_messaging_broadcast_jobs.segment_id IS 'recipient_source=segment のときの参照（受信者は作成時に解決してスナップショット）';

ALTER TABLE line_messaging_broadcast_jobs
  DROP CONSTRAINT IF EXISTS line_messaging_broadcast_jobs_recipient_source_check;

ALTER TABLE line_messaging_broadcast_jobs
  ADD CONSTRAINT line_messaging_broadcast_jobs_recipient_source_check
  CHECK (recipient_source IN ('all_followed', 'explicit', 'segment'));

-- OAM 突合レポート用（customer_id = line_user_id の EXISTS を高速化）
CREATE INDEX IF NOT EXISTS idx_line_oam_rewardcard_txns_customer_id
  ON line_oam_rewardcard_txns (customer_id);

-- ============================================================
-- LINE Messaging Phase F: リッチメニュー・出し分け・Flex テンプレ
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_rich_menus (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  line_rich_menu_id  TEXT,
  size               JSONB NOT NULL DEFAULT '{"width":2500,"height":1686}'::jsonb,
  chat_bar_text      TEXT NOT NULL DEFAULT 'メニュー',
  selected           BOOLEAN NOT NULL DEFAULT false,
  areas              JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_rich_menus_service
  ON line_messaging_rich_menus (service_id);

COMMENT ON COLUMN line_messaging_rich_menus.line_rich_menu_id IS 'LINE が発行する richMenuId（作成 API 成功後に保存）';
COMMENT ON COLUMN line_messaging_rich_menus.areas IS 'Messaging API の areas 配列（postback.data は postback_bindings.data_key と一致させる）';

CREATE TRIGGER trg_line_messaging_rich_menus_updated_at
  BEFORE UPDATE ON line_messaging_rich_menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_rich_menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_rich_menus"
  ON line_messaging_rich_menus FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_rich_menus"
  ON line_messaging_rich_menus FOR ALL TO service_role USING (true) WITH CHECK (true);

-- セグメント別に適用するリッチメニュー（優先度昇順で先に一致したものを採用。segment_id NULL は最後のフォールバック用）
CREATE TABLE IF NOT EXISTS line_messaging_rich_menu_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  priority      INT NOT NULL DEFAULT 100,
  rich_menu_id  UUID NOT NULL REFERENCES line_messaging_rich_menus(id) ON DELETE CASCADE,
  segment_id    UUID REFERENCES line_messaging_segments(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_rich_menu_rules_service
  ON line_messaging_rich_menu_rules (service_id, priority);

CREATE TRIGGER trg_line_messaging_rich_menu_rules_updated_at
  BEFORE UPDATE ON line_messaging_rich_menu_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_rich_menu_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_rich_menu_rules"
  ON line_messaging_rich_menu_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_rich_menu_rules"
  ON line_messaging_rich_menu_rules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- postback.data 文字列 → MA アクション（最大 300 文字に収めるため短いキーを推奨）
CREATE TABLE IF NOT EXISTS line_messaging_postback_bindings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  data_key      TEXT NOT NULL,
  actions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, data_key)
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_postback_bindings_service
  ON line_messaging_postback_bindings (service_id);

CREATE TRIGGER trg_line_messaging_postback_bindings_updated_at
  BEFORE UPDATE ON line_messaging_postback_bindings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_postback_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_postback_bindings"
  ON line_messaging_postback_bindings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_postback_bindings"
  ON line_messaging_postback_bindings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Flex / カルーセル JSON テンプレ（プレビューはクライアントで template_json を利用）
CREATE TABLE IF NOT EXISTS line_messaging_flex_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  template_kind  TEXT NOT NULL DEFAULT 'flex'
                 CHECK (template_kind IN ('flex', 'carousel')),
  template_json  JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_flex_templates_service
  ON line_messaging_flex_templates (service_id);

CREATE TRIGGER trg_line_messaging_flex_templates_updated_at
  BEFORE UPDATE ON line_messaging_flex_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_flex_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_flex_templates"
  ON line_messaging_flex_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_flex_templates"
  ON line_messaging_flex_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

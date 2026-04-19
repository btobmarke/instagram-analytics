-- ============================================================
-- LINE Messaging Phase G: 短縮 URL・CV・ファネル定義
-- ============================================================

CREATE TABLE IF NOT EXISTS line_messaging_short_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT,
  target_url   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_short_links_service
  ON line_messaging_short_links (service_id);

CREATE TRIGGER trg_line_messaging_short_links_updated_at
  BEFORE UPDATE ON line_messaging_short_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE line_messaging_short_links IS
  'メッセージ内などに埋め込む短縮 URL。/r/{code} でリダイレクトしクリックを記録';

ALTER TABLE line_messaging_short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_short_links"
  ON line_messaging_short_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_short_links"
  ON line_messaging_short_links FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 匿名クリックも service_role のみ挿入（公開リダイレクト API から）
CREATE TABLE IF NOT EXISTS line_messaging_link_clicks (
  id             BIGSERIAL PRIMARY KEY,
  service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  short_link_id  UUID NOT NULL REFERENCES line_messaging_short_links(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES line_messaging_contacts(id) ON DELETE SET NULL,
  line_user_id   TEXT,
  utm            JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_agent     TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_link_clicks_link_time
  ON line_messaging_link_clicks (short_link_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_line_messaging_link_clicks_service_time
  ON line_messaging_link_clicks (service_id, occurred_at DESC);

ALTER TABLE line_messaging_link_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_link_clicks"
  ON line_messaging_link_clicks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_link_clicks"
  ON line_messaging_link_clicks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- G2: コンバージョン（イベント trigger_type の一致で 1 CV とみなす）
CREATE TABLE IF NOT EXISTS line_messaging_conversion_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  match_trigger_type TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_cv_defs_service
  ON line_messaging_conversion_definitions (service_id);

CREATE TRIGGER trg_line_messaging_conversion_definitions_updated_at
  BEFORE UPDATE ON line_messaging_conversion_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_conversion_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_conversion_definitions"
  ON line_messaging_conversion_definitions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_conversion_definitions"
  ON line_messaging_conversion_definitions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- G4: ファネル（順序のある trigger_type ステップ）
CREATE TABLE IF NOT EXISTS line_messaging_funnels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  steps        JSONB NOT NULL,
  max_step_gap_hours INT NOT NULL DEFAULT 168,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messaging_funnels_service
  ON line_messaging_funnels (service_id);

COMMENT ON COLUMN line_messaging_funnels.steps IS
  '["webhook.follow","form.submitted","scenario.step_sent"] のような trigger_type の配列';

CREATE TRIGGER trg_line_messaging_funnels_updated_at
  BEFORE UPDATE ON line_messaging_funnels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE line_messaging_funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full line_messaging_funnels"
  ON line_messaging_funnels FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role full line_messaging_funnels"
  ON line_messaging_funnels FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ファネル集計用
CREATE INDEX IF NOT EXISTS idx_line_messaging_events_service_trigger_time
  ON line_messaging_events (service_id, trigger_type, occurred_at DESC);

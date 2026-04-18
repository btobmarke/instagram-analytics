-- Instagram サービス単位の KPI 設定（フェーズ・名称・目標・カード種別・説明）

CREATE TABLE IF NOT EXISTS instagram_service_kpis (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  phase            INT NOT NULL,
  kpi_name         TEXT NOT NULL,
  target_value     INT NOT NULL,
  card_type        TEXT NOT NULL CHECK (card_type IN ('metric_card', 'custom_card')),
  kpi_description  TEXT NOT NULL DEFAULT '',
  display_order    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_service_kpis_service
  ON instagram_service_kpis (service_id);

CREATE TRIGGER trg_instagram_service_kpis_updated_at
  BEFORE UPDATE ON instagram_service_kpis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE instagram_service_kpis IS
  'Instagram サービス詳細の KPI 設定タブ用。指標値カード／カスタムカードの表示種別を含む。';

ALTER TABLE instagram_service_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_instagram_service_kpis"
  ON instagram_service_kpis FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_instagram_service_kpis"
  ON instagram_service_kpis FOR ALL TO service_role
  USING (true) WITH CHECK (true);

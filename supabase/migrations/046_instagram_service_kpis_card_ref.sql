-- KPI 行で参照する指標カード ID（カタログの MetricCard.id またはカスタム指標 UUID）

ALTER TABLE instagram_service_kpis
  ADD COLUMN IF NOT EXISTS card_ref TEXT;

COMMENT ON COLUMN instagram_service_kpis.card_ref IS
  'サマリーと同じ指標 ID。指標値カードは catalog の id、カスタムは service_custom_metrics.id。';

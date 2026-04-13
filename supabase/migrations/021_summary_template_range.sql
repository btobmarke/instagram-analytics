-- サマリーテンプレート: 横軸「期間指定（YYYYMMDD~YYYYMMDD）」用
ALTER TABLE summary_templates
  ADD COLUMN IF NOT EXISTS range_start DATE,
  ADD COLUMN IF NOT EXISTS range_end   DATE;

COMMENT ON COLUMN summary_templates.range_start IS 'time_unit=custom_range の開始日（含む）';
COMMENT ON COLUMN summary_templates.range_end   IS 'time_unit=custom_range の終了日（含む）';

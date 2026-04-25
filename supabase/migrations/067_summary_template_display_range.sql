-- サマリーテンプレート: 集計粒度とは別の「表示期間」（横軸の列範囲）
ALTER TABLE summary_templates
  ADD COLUMN IF NOT EXISTS display_range_start DATE,
  ADD COLUMN IF NOT EXISTS display_range_end   DATE;

COMMENT ON COLUMN summary_templates.display_range_start IS
  'time_unit が hour/day/week/month のとき、横軸の開始日（含む）。未設定時は従来どおり直近 N 列。';
COMMENT ON COLUMN summary_templates.display_range_end IS
  'time_unit が hour/day/week/month のとき、横軸の終了日（含む）。';

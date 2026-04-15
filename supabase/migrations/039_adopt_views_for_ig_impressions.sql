-- ============================================================
-- Migration 039: adopt `views` as impressions-equivalent (Instagram v22+)
--
-- 背景:
-- - Instagram Graph API v22+ では organic media insights の `impressions` が非推奨となり、
--   実装上は `views` をインプレッション相当として扱う。
-- - 既存の kpi_master 設定（numerator_source='impressions'）を `views` に寄せる。
-- ============================================================

UPDATE kpi_master
SET numerator_source = 'views'
WHERE kpi_code IN ('impressions_per_post', 'impressions_to_reach');


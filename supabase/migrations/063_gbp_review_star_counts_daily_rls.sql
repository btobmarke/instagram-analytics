-- サマリー API（authenticated）が gbp_review_star_counts_daily を読めるようにする。
-- RLS ON かつポリシー無しの状態だと PostgREST は行を返さず、星別日次が常に欠損になる。

ALTER TABLE gbp_review_star_counts_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_gbp_review_star_counts_daily"
  ON gbp_review_star_counts_daily;
CREATE POLICY "authenticated_select_gbp_review_star_counts_daily"
  ON gbp_review_star_counts_daily
  FOR SELECT
  TO authenticated
  USING (true);

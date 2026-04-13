-- 付与ログベース: 期間内に「取引が min 回以上あるユニーク顧客数」を都度集計する（来店スタンプ回数など）
-- line_oam_rewardcard_txns の1行 = CSV上の1付与イベントとみなす

CREATE OR REPLACE FUNCTION public.line_oam_users_meeting_min_txn_count(
  p_service_id uuid,
  p_range_start date,
  p_range_end date,
  p_min_count integer,
  p_line_rewardcard_id uuid DEFAULT NULL,
  p_point_type text DEFAULT NULL
)
RETURNS TABLE (
  qualifying_user_count bigint,
  txn_row_count_in_range bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH bounds AS (
    SELECT
      (p_range_start::text || ' 00:00:00+09')::timestamptz AS ts_start,
      ((p_range_end + 1)::text || ' 00:00:00+09')::timestamptz AS ts_end_excl
  ),
  scoped AS (
    SELECT t.customer_id
    FROM line_oam_rewardcard_txns t
    INNER JOIN line_oam_rewardcards rc ON rc.id = t.line_rewardcard_id
    CROSS JOIN bounds b
    WHERE rc.service_id = p_service_id
      AND (p_line_rewardcard_id IS NULL OR t.line_rewardcard_id = p_line_rewardcard_id)
      AND t.txn_datetime >= b.ts_start
      AND t.txn_datetime < b.ts_end_excl
      AND (p_point_type IS NULL OR t.point_type = p_point_type)
  ),
  per_user AS (
    SELECT customer_id, COUNT(*)::bigint AS cnt
    FROM scoped
    GROUP BY customer_id
  )
  SELECT
    COALESCE((SELECT COUNT(*)::bigint FROM per_user WHERE cnt >= p_min_count::bigint), 0)::bigint,
    COALESCE((SELECT COUNT(*)::bigint FROM scoped), 0)::bigint;
$$;

COMMENT ON FUNCTION public.line_oam_users_meeting_min_txn_count IS
  '期間内のリワードカード取引を1回として顧客ごとに数え、回数が p_min_count 以上の顧客数を返す。point_type で来店スタンプ等に絞り込み可能。';

REVOKE ALL ON FUNCTION public.line_oam_users_meeting_min_txn_count FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.line_oam_users_meeting_min_txn_count TO service_role;

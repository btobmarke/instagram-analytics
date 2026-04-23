-- サマリー用: GBP クチコミの全期間（サイト単位）累計件数・平均星（1〜5 のみ分母）
-- アプリは PostgREST の rpc で 1 往復取得する。

CREATE OR REPLACE FUNCTION public.gbp_reviews_lifetime_aggregates(p_site_id uuid)
RETURNS TABLE (
  total_review_count bigint,
  avg_star_rating numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::bigint AS total_review_count,
    CASE
      WHEN COUNT(*) FILTER (WHERE star_rating IN ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE')) = 0 THEN NULL
      ELSE ROUND(
        (
          SUM(
            CASE star_rating
              WHEN 'ONE' THEN 1
              WHEN 'TWO' THEN 2
              WHEN 'THREE' THEN 3
              WHEN 'FOUR' THEN 4
              WHEN 'FIVE' THEN 5
              ELSE NULL
            END
          )::numeric
          / NULLIF(
              COUNT(*) FILTER (WHERE star_rating IN ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE')),
              0
            )::numeric
        ),
        2
      )
    END AS avg_star_rating
  FROM gbp_reviews
  WHERE gbp_site_id = p_site_id;
$$;

COMMENT ON FUNCTION public.gbp_reviews_lifetime_aggregates(uuid) IS
  'GBP クチコミ: サイト別の累計件数（全行）と平均星（ONE〜FIVE のみ平均。星なしは分母・分子に含めない）。';

GRANT EXECUTE ON FUNCTION public.gbp_reviews_lifetime_aggregates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gbp_reviews_lifetime_aggregates(uuid) TO service_role;

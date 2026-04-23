-- 累計口コミ・平均星を「各列の期間終端時点」までに変更する。
-- p_cutoffs[i] = サマリー Period[i].end（半開区間の上端）→ create_time < cutoff でその時点までの累計。

DROP FUNCTION IF EXISTS public.gbp_reviews_lifetime_aggregates(uuid);

CREATE OR REPLACE FUNCTION public.gbp_reviews_cumulative_by_cutoffs(
  p_site_id uuid,
  p_cutoffs timestamptz[]
)
RETURNS TABLE (
  ord integer,
  total_review_count bigint,
  avg_star_rating numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    u.ord::integer AS ord,
    (
      SELECT COUNT(*)::bigint
      FROM gbp_reviews r
      WHERE r.gbp_site_id = p_site_id
        AND r.create_time < u.cutoff
    ) AS total_review_count,
    (
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE r2.star_rating IN ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE')) = 0 THEN NULL
          ELSE ROUND(
            (
              SUM(
                CASE r2.star_rating
                  WHEN 'ONE' THEN 1
                  WHEN 'TWO' THEN 2
                  WHEN 'THREE' THEN 3
                  WHEN 'FOUR' THEN 4
                  WHEN 'FIVE' THEN 5
                  ELSE NULL
                END
              )::numeric
              / NULLIF(
                  COUNT(*) FILTER (WHERE r2.star_rating IN ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE')),
                  0
                )::numeric
            ),
            2
          )
        END
      FROM gbp_reviews r2
      WHERE r2.gbp_site_id = p_site_id
        AND r2.create_time < u.cutoff
    ) AS avg_star_rating
  FROM unnest(p_cutoffs) WITH ORDINALITY AS u(cutoff, ord)
  ORDER BY u.ord;
$$;

COMMENT ON FUNCTION public.gbp_reviews_cumulative_by_cutoffs(uuid, timestamptz[]) IS
  'GBP クチコミ: 各 cutoff 時点より前の create_time の行について、累計件数と平均星（ONE〜FIVE のみ）。cutoff は Period.end（半開区間の上端）を渡す。';

GRANT EXECUTE ON FUNCTION public.gbp_reviews_cumulative_by_cutoffs(uuid, timestamptz[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gbp_reviews_cumulative_by_cutoffs(uuid, timestamptz[]) TO service_role;

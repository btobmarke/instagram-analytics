-- クチコミの星別・日次件数（レビュー投稿日を JST の暦日で集計）
-- stars_none: API の STAR_RATING_UNSPECIFIED、NULL、想定外文字列

CREATE TABLE IF NOT EXISTS gbp_review_star_counts_daily (
  id             BIGSERIAL PRIMARY KEY,
  gbp_site_id    UUID NOT NULL REFERENCES gbp_sites(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  stars_1        INT NOT NULL DEFAULT 0,
  stars_2        INT NOT NULL DEFAULT 0,
  stars_3        INT NOT NULL DEFAULT 0,
  stars_4        INT NOT NULL DEFAULT 0,
  stars_5        INT NOT NULL DEFAULT 0,
  stars_none     INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gbp_site_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_review_star_counts_site_date
  ON gbp_review_star_counts_daily(gbp_site_id, date DESC);

COMMENT ON TABLE gbp_review_star_counts_daily IS
  'GBP クチコミを投稿日（Asia/Tokyo の暦日）× 星ごとの件数。stars_none は星未指定・NULL・想定外。';

COMMENT ON COLUMN gbp_review_star_counts_daily.stars_none IS
  'STAR_RATING_UNSPECIFIED、NULL、ONE〜FIVE 以外の star_rating をカウント';

CREATE OR REPLACE TRIGGER trg_gbp_review_star_counts_updated_at
  BEFORE UPDATE ON gbp_review_star_counts_daily
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

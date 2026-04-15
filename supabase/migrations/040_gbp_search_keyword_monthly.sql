-- GBP Performance API: searchkeywords.impressions.monthly の保存先
-- https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list

CREATE TABLE IF NOT EXISTS gbp_search_keyword_monthly (
  id               BIGSERIAL PRIMARY KEY,
  gbp_site_id      UUID NOT NULL REFERENCES gbp_sites(id) ON DELETE CASCADE,
  year             INT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month            INT NOT NULL CHECK (month >= 1 AND month <= 12),
  search_keyword   TEXT NOT NULL,
  impressions      BIGINT,
  threshold        TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gbp_site_id, year, month, search_keyword)
);

CREATE INDEX IF NOT EXISTS idx_gbp_search_kw_site_ym
  ON gbp_search_keyword_monthly(gbp_site_id, year DESC, month DESC);

CREATE OR REPLACE TRIGGER trg_gbp_search_keyword_monthly_updated_at
  BEFORE UPDATE ON gbp_search_keyword_monthly
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

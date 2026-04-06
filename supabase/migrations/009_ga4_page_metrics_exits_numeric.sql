-- screenPageViewsPerSession 等の小数を格納するため、exits を整数から NUMERIC に変更
-- （列名は歴史的経緯で exits のまま）

ALTER TABLE ga4_page_metrics
  ALTER COLUMN exits TYPE NUMERIC(14, 8) USING exits::numeric;

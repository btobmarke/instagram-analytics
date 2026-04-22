-- Instagram アカウントインサイト: デモグラフィックの dimension_value 実サンプル確認
--
-- 背景:
-- - insight-collector は API の breakdown 結果で dimension_values[] を
--   '|' で連結して ig_account_insight_fact.dimension_value に保存します
--   （単一ブレークダウンなら通常 1 要素のみで、値そのものが入ります）。
-- - follower_demographics / engaged_audience_demographics は period_code='lifetime'、
--   dimension_code は age / gender / country / city など API の breakdown に一致します。
--
-- 使い方: Supabase SQL Editor 等で実行し、自ワークスペースの実データで値の綴りを確認してください。
-- 特定アカウントだけ見る場合は下の WHERE のコメントを外して account_id を指定します。

-- 1) 年齢バケット（age）— 出現する dimension_value の一覧と件数
SELECT
  dimension_value,
  COUNT(*) AS row_count,
  MAX(value_date) AS latest_value_date
FROM ig_account_insight_fact
WHERE metric_code = 'follower_demographics'
  AND period_code = 'lifetime'
  AND dimension_code = 'age'
  AND dimension_value <> ''
  -- AND account_id = 'YOUR_IG_USER_ID'
GROUP BY dimension_value
ORDER BY row_count DESC, dimension_value;

-- 2) 性別（gender）— 参考（FEMALE / MALE / U など）
SELECT
  dimension_value,
  COUNT(*) AS row_count,
  MAX(value_date) AS latest_value_date
FROM ig_account_insight_fact
WHERE metric_code = 'follower_demographics'
  AND period_code = 'lifetime'
  AND dimension_code = 'gender'
  AND dimension_value <> ''
GROUP BY dimension_value
ORDER BY row_count DESC, dimension_value;

-- 3) エンゲージ層の年齢（同じく age）
SELECT
  dimension_value,
  COUNT(*) AS row_count,
  MAX(value_date) AS latest_value_date
FROM ig_account_insight_fact
WHERE metric_code = 'engaged_audience_demographics'
  AND period_code = 'lifetime'
  AND dimension_code = 'age'
  AND dimension_value <> ''
GROUP BY dimension_value
ORDER BY row_count DESC, dimension_value;

-- 4) 任意: パイプ区切りが混ざっているか（複合キー）の有無確認
SELECT
  COUNT(*) FILTER (WHERE dimension_value LIKE '%|%' ) AS rows_with_pipe,
  COUNT(*) AS total_rows
FROM ig_account_insight_fact
WHERE metric_code IN ('follower_demographics', 'engaged_audience_demographics')
  AND period_code = 'lifetime'
  AND dimension_code IN ('age', 'gender', 'country', 'city')
  AND dimension_value <> '';

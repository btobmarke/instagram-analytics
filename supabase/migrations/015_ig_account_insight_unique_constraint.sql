-- Migration 015: Fix ig_account_insight_fact unique constraint
--
-- 問題: 既存のユニーク制約が EXPRESSION INDEX (COALESCE) で定義されており、
--       PostgreSQL の ON CONFLICT (column_list) では式ベースのインデックスを参照できない。
-- 解決: dimension_code / dimension_value を NOT NULL DEFAULT '' に変更し、
--       通常のカラムリストによるユニーク制約に置き換える。

-- 1. NULL値を空文字に変換
UPDATE ig_account_insight_fact
SET
  dimension_code  = COALESCE(dimension_code,  ''),
  dimension_value = COALESCE(dimension_value, '');

-- 2. カラムを NOT NULL DEFAULT '' に変更
ALTER TABLE ig_account_insight_fact
  ALTER COLUMN dimension_code  SET DEFAULT '',
  ALTER COLUMN dimension_code  SET NOT NULL,
  ALTER COLUMN dimension_value SET DEFAULT '',
  ALTER COLUMN dimension_value SET NOT NULL;

-- 3. 既存の式ベースユニークインデックスを削除
DROP INDEX IF EXISTS idx_ig_account_insight_unique;

-- 4. 通常のユニーク制約を追加（ON CONFLICT で参照可能）
ALTER TABLE ig_account_insight_fact
  ADD CONSTRAINT uq_ig_account_insight
  UNIQUE (account_id, metric_code, period_code, value_date, dimension_code, dimension_value);

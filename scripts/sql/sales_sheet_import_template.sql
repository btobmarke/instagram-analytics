-- ============================================================
-- 店舗日報（スプレッドシート）→ sales_days + sales_hourly_slots
--
-- スキーマ: supabase/migrations/023_sales_analytics.sql
--
-- 【列の対応】
--   年・月・日        → sales_days.sales_date
--   曜日              → DB に保持しない（必要なら memo の JSON に含める）
--   ランチ/ディナー/店内（税込・税抜）→ 子行 slot_label で区別し金額を格納
--   税額列（ランチ税等）→ テーブルに無いので sales_days.memo に JSON で格納
--   11:00〜21:00 枚数・税込・税抜 → 1時間枠ごとに sales_hourly_slots 1行
--      枚数は memo に '{"ticket_count":18}' のように JSON で保持
--
-- 【運用ルール】
--   - 同一営業日は親 sales_days を 1 行にするため session_label を固定
--     （例: '本店' または店舗コード）
--   - 子の slot_label は下記の固定ラベル（UPSERT しやすい）
--
-- 【置換】 service_id の UUID を対象の売上サービスに変更してから実行。
-- ============================================================

-- 例: 2026-01-04（木）1日分（ユーザー提示データに基づく）

INSERT INTO sales_days (service_id, sales_date, session_label, data_source, memo)
VALUES (
  '1eaee33d-eece-4fe5-a511-8f863cd75bcf'::uuid,
  '2026-01-04',
  '本店',
  'manual',
  '{"source":"spreadsheet","weekday":"木","lunch_tax_in":83250,"lunch_tax_amount":7532,"dinner_tax_in":32550,"dinner_tax_amount":2947,"store_tax_in":115800,"store_tax_amount":10479}'::text
)
ON CONFLICT (service_id, sales_date, session_label)
DO UPDATE SET
  memo = EXCLUDED.memo,
  updated_at = now();

WITH d AS (
  SELECT id
  FROM sales_days
  WHERE service_id = '1eaee33d-eece-4fe5-a511-8f863cd75bcf'::uuid
    AND sales_date = '2026-01-04'
    AND session_label = '本店'
)
INSERT INTO sales_hourly_slots (
  sales_day_id,
  slot_label,
  session_start_time,
  session_end_time,
  total_amount_with_tax,
  total_amount_without_tax,
  business_hours_minutes,
  is_rest_break,
  memo
)
SELECT
  d.id,
  v.slot_label,
  v.t_start,
  v.t_end,
  v.amt_in,
  v.amt_ex,
  CASE
    WHEN v.t_start IS NOT NULL AND v.t_end IS NOT NULL
    THEN (EXTRACT(EPOCH FROM (v.t_end - v.t_start))::int / 60)
    ELSE NULL
  END,
  false,
  v.slot_memo
FROM d
CROSS JOIN (VALUES
  ('ランチ（税込）', NULL::time, NULL::time, 83250::numeric, 75718::numeric, NULL::text),
  ('ディナー（税込）', NULL::time, NULL::time, 32550::numeric, 29603::numeric, NULL::text),
  ('店内売上（税込）', NULL::time, NULL::time, 115800::numeric, 105321::numeric, NULL::text),
  ('11:00-12:00', '11:00'::time, '12:00'::time, 16500::numeric, 15000::numeric, '{"ticket_count":18}'::text),
  ('12:00-13:00', '12:00'::time, '13:00'::time, 28570::numeric, 25973::numeric, '{"ticket_count":34}'::text),
  ('13:00-14:00', '13:00'::time, '14:00'::time, 19730::numeric, 17936::numeric, '{"ticket_count":22}'::text),
  ('14:00-15:00', '14:00'::time, '15:00'::time, 18450::numeric, 16773::numeric, '{"ticket_count":22}'::text),
  ('15:00-16:00', '15:00'::time, '16:00'::time, 0::numeric, 0::numeric, '{"ticket_count":0}'::text),
  ('16:00-17:00', '16:00'::time, '17:00'::time, 0::numeric, 0::numeric, '{"ticket_count":0}'::text),
  ('17:00-18:00', '17:00'::time, '18:00'::time, 0::numeric, 0::numeric, '{"ticket_count":0}'::text),
  ('18:00-19:00', '18:00'::time, '19:00'::time, 3380::numeric, 3073::numeric, '{"ticket_count":6}'::text),
  ('19:00-20:00', '19:00'::time, '20:00'::time, 8700::numeric, 7909::numeric, '{"ticket_count":9}'::text),
  ('20:00-21:00', '20:00'::time, '21:00'::time, 15790::numeric, 14355::numeric, '{"ticket_count":17}'::text),
  ('21:00-22:00', '21:00'::time, '22:00'::time, 4700::numeric, 4273::numeric, '{"ticket_count":5}'::text)
) AS v(slot_label, t_start, t_end, amt_in, amt_ex, slot_memo)
ON CONFLICT (sales_day_id, slot_label) DO UPDATE SET
  session_start_time = EXCLUDED.session_start_time,
  session_end_time = EXCLUDED.session_end_time,
  total_amount_with_tax = EXCLUDED.total_amount_with_tax,
  total_amount_without_tax = EXCLUDED.total_amount_without_tax,
  business_hours_minutes = EXCLUDED.business_hours_minutes,
  memo = EXCLUDED.memo,
  updated_at = now();

-- ============================================================
-- 他日を追加するとき
--   1) INSERT sales_days の sales_date / memo（税額JSON）を差し替え
--   2) WITH d の条件の日付を同じにする
--   3) VALUES の数値・ticket_count を行データに合わせる
--
-- 「合計」「空行」は INSERT 対象外。
-- ============================================================

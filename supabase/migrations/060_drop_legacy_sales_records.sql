-- ============================================================
-- Migration 060: 旧売上スキーマ（sales_records 単体表）の削除
--
-- 023 を旧定義のまま適用済みの DB に、新スキーマ（sales_days +
-- sales_hourly_slots）へ移行したあと、不要になったテーブルを落とす。
--
-- 新スキーマのみの環境（sales_records が存在しない）では何もしない。
-- 判定: public.sales_records が存在し、かつ public.orders に sales_id 列がある
--       （旧スキーマ）ときのみ DROP。新スキーマのみ（sales_id なし）では何もしない。
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sales_records'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'sales_id'
  ) THEN
    -- order_items は orders の CASCADE で削除される
    DROP TABLE IF EXISTS public.orders CASCADE;
    DROP TABLE IF EXISTS public.product_daily_outputs CASCADE;
    DROP TABLE IF EXISTS public.sales_records CASCADE;
  END IF;
END $$;

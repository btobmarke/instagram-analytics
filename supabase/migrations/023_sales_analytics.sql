-- ============================================================
-- Migration 023: 売上分析スキーマ
--   product_master         … 商品マスタ（サービス単位）
--   sales_records          … 売上データ（日次・締め単位）
--   orders                 … 注文データ
--   order_items            … 注文明細
--   product_daily_outputs  … 商品出数（日次）
-- ============================================================

-- 1. service_type CHECK 制約に 'sales' を追加
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_service_type_check;
ALTER TABLE services DROP CONSTRAINT IF EXISTS chk_service_type;

ALTER TABLE services ADD CONSTRAINT services_service_type_check
  CHECK (service_type IN (
    'instagram', 'gbp', 'line', 'lp', 'ga4', 'clarity',
    'google_ads', 'summary', 'x', 'meta_ads', 'owned_media', 'sales'
  ));

-- 2. 商品マスタ
CREATE TABLE IF NOT EXISTS product_master (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_code               TEXT,
  item_name               TEXT NOT NULL,
  unit_price_with_tax     NUMERIC(12, 2),
  unit_price_without_tax  NUMERIC(12, 2),
  tax_rate                NUMERIC(5, 4),          -- 例: 0.1000 = 10%
  cost_price              NUMERIC(12, 2),
  has_stock_management    BOOLEAN NOT NULL DEFAULT false,
  stock_quantity          INTEGER,
  sales_start_date        DATE,
  sales_end_date          DATE,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_product_master_service_id
  ON product_master(service_id);

CREATE OR REPLACE TRIGGER trg_product_master_updated_at
  BEFORE UPDATE ON product_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_users_all" ON product_master
  FOR ALL USING (auth.role() = 'authenticated');

-- 3. 売上データ（日次・締め単位）
CREATE TABLE IF NOT EXISTS sales_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sales_date              DATE NOT NULL,
  session_label           TEXT NOT NULL DEFAULT 'all',    -- 例: 'all', '第1部', '第2部'
  session_start_time      TIME,                           -- 例: 11:00
  session_end_time        TIME,                           -- 例: 14:00
  -- 'pos': 注文データ・注文明細あり / 'manual': 商品出数のみ
  data_source             TEXT NOT NULL DEFAULT 'pos'
                          CHECK (data_source IN ('pos', 'manual')),
  total_amount_with_tax   NUMERIC(12, 2),
  total_amount_without_tax NUMERIC(12, 2),
  business_hours_minutes  INTEGER,
  memo                    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, sales_date, session_label)
);

CREATE INDEX IF NOT EXISTS idx_sales_records_service_date
  ON sales_records(service_id, sales_date DESC);

CREATE OR REPLACE TRIGGER trg_sales_records_updated_at
  BEFORE UPDATE ON sales_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE sales_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_users_all" ON sales_records
  FOR ALL USING (auth.role() = 'authenticated');

-- 4. 注文データ
CREATE TABLE IF NOT EXISTS orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id                 UUID NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
  ordered_at               TIMESTAMPTZ NOT NULL,
  amount_with_tax          NUMERIC(12, 2),
  amount_without_tax       NUMERIC(12, 2),
  -- 注文レベル割引（クーポン等）: order_discount + sum(item.discount) = total_discount
  order_discount_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_discount_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  memo                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_sales_id
  ON orders(sales_id);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at
  ON orders(ordered_at DESC);

CREATE OR REPLACE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_users_all" ON orders
  FOR ALL USING (auth.role() = 'authenticated');

-- 5. 注文明細
CREATE TABLE IF NOT EXISTS order_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id                 UUID REFERENCES product_master(id) ON DELETE SET NULL,
  item_code               TEXT,
  item_name               TEXT NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 1,
  -- 注文時点の価格スナップショット
  unit_price_with_tax     NUMERIC(12, 2),
  unit_price_without_tax  NUMERIC(12, 2),
  tax_rate                NUMERIC(5, 4),
  cost_price              NUMERIC(12, 2),
  -- 明細レベルの割引額（商品割引）
  discount_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_item_id
  ON order_items(item_id);

CREATE OR REPLACE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_users_all" ON order_items
  FOR ALL USING (auth.role() = 'authenticated');

-- 6. 商品出数（日次・締め単位）
CREATE TABLE IF NOT EXISTS product_daily_outputs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_id                UUID NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
  item_id                 UUID REFERENCES product_master(id) ON DELETE SET NULL,
  item_code               TEXT,
  item_name               TEXT NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 0,
  -- 記録時点の価格スナップショット
  unit_price_with_tax     NUMERIC(12, 2),
  unit_price_without_tax  NUMERIC(12, 2),
  tax_rate                NUMERIC(5, 4),
  cost_price              NUMERIC(12, 2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sales_id, item_id),
  UNIQUE (sales_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_product_daily_outputs_sales_id
  ON product_daily_outputs(sales_id);
CREATE INDEX IF NOT EXISTS idx_product_daily_outputs_item_id
  ON product_daily_outputs(item_id);

CREATE OR REPLACE TRIGGER trg_product_daily_outputs_updated_at
  BEFORE UPDATE ON product_daily_outputs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_daily_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_users_all" ON product_daily_outputs
  FOR ALL USING (auth.role() = 'authenticated');

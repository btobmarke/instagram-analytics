-- ============================================================
-- Migration 008: instagram_accounts テーブルを廃止
--   ig_accounts に service_id を直接持たせてシンプル化
-- ============================================================

-- 1. ig_accounts に service_id カラムを追加
ALTER TABLE ig_accounts
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;

-- 2. ユニークインデックス（1サービス = 1アカウント）
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_accounts_service_id
  ON ig_accounts(service_id)
  WHERE service_id IS NOT NULL;

-- 3. 既存データを ig_accounts.service_id へ移行
--    instagram_accounts.ig_account_ref_id → ig_accounts.id で突合
UPDATE ig_accounts AS ig
SET service_id = ia.service_id
FROM instagram_accounts AS ia
WHERE ia.ig_account_ref_id = ig.id
  AND ig.service_id IS NULL;

-- 4. instagram_accounts テーブルを廃止
DROP TABLE IF EXISTS instagram_accounts;

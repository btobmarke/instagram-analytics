-- ============================================================
-- Migration 010: services テーブルに論理削除カラムを追加
-- ============================================================

-- 1. deleted_at カラムを追加
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. 未削除行のみを対象としたインデックス（クエリ高速化）
CREATE INDEX IF NOT EXISTS idx_services_not_deleted
  ON services(project_id, display_order)
  WHERE deleted_at IS NULL;

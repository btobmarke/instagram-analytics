-- Migration 024: プロジェクト横断サマリー外生変数テーブル
--
-- 背景: 祝日・天気などの外生変数をプロジェクト単位で保存し、
--       横断サマリーのデータ表に「祝日・天気・気温」列として表示する。

-- ─────────────────────────────────────────────────────────────
-- 1. プロジェクト外生変数（祝日・天気）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_external_daily (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  is_holiday        BOOLEAN,
  holiday_name      TEXT,
  temperature_max   NUMERIC(5,1),
  temperature_min   NUMERIC(5,1),
  precipitation_mm  NUMERIC(6,1),
  weather_code      INTEGER,
  weather_desc      TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, date)
);

CREATE INDEX idx_project_external_daily_project_date
  ON project_external_daily (project_id, date DESC);

ALTER TABLE project_external_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON project_external_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON project_external_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. projects テーブルに位置情報カラムを追加（天気取得用）
-- ─────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude     NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS location_name TEXT;

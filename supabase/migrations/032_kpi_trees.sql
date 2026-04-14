-- ============================================================
-- 032_kpi_trees.sql
-- KPI ツリーを複数管理できるようにするためのマイグレーション
--
-- 変更内容:
--   1. kpi_trees テーブルを新規作成
--   2. project_kpi_tree_nodes に kpi_tree_id を追加
--   3. project_analysis_presets に kpi_tree_id / is_stale を追加
--   4. kpi_validation_periods テーブルを新規作成
--   5. 既存データを「デフォルトツリー」に移行
--   6. ノード変更時にプリセットを自動 stale 化するトリガーを追加
-- ============================================================

-- ── 1. kpi_trees テーブル ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kpi_trees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT 'デフォルトツリー',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kpi_trees_project_idx
  ON kpi_trees (project_id, created_at ASC);

CREATE TRIGGER trg_kpi_trees_updated_at
  BEFORE UPDATE ON kpi_trees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_trees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on kpi_trees"
  ON kpi_trees FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on kpi_trees"
  ON kpi_trees FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 2. project_kpi_tree_nodes に kpi_tree_id を追加 ───────────────────────────

ALTER TABLE project_kpi_tree_nodes
  ADD COLUMN IF NOT EXISTS kpi_tree_id uuid REFERENCES kpi_trees(id) ON DELETE CASCADE;

-- 複合インデックス追加（ツリー単位の検索に使用）
CREATE INDEX IF NOT EXISTS project_kpi_tree_nodes_tree_idx
  ON project_kpi_tree_nodes (kpi_tree_id, parent_id, sort_order);

-- ── 3. project_analysis_presets に kpi_tree_id / is_stale を追加 ──────────────

ALTER TABLE project_analysis_presets
  ADD COLUMN IF NOT EXISTS kpi_tree_id uuid REFERENCES kpi_trees(id) ON DELETE CASCADE;

ALTER TABLE project_analysis_presets
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

-- ツリー単位の検索インデックス
CREATE INDEX IF NOT EXISTS project_analysis_presets_tree_idx
  ON project_analysis_presets (kpi_tree_id, created_at DESC);

-- ── 4. kpi_validation_periods テーブル ────────────────────────────────────────
-- 学習済みモデルの精度を特定期間の実績データで検証するためのレコード

CREATE TABLE IF NOT EXISTS kpi_validation_periods (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_tree_id   uuid        NOT NULL REFERENCES kpi_trees(id) ON DELETE CASCADE,
  name          text,                        -- ユーザーが付ける任意の名前（例: "4月検証"）
  start_date    date        NOT NULL,
  end_date      date        NOT NULL,
  -- pending: 終了日未到達 / running: 評価中 / completed: 完了 / failed: 失敗
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- 評価結果: { preset_id: { mape, rmse, r2, n_obs, residuals: [...] } }
  results       jsonb       DEFAULT NULL,
  error_message text        DEFAULT NULL,
  evaluated_at  timestamptz DEFAULT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kpi_validation_periods_tree_idx
  ON kpi_validation_periods (kpi_tree_id, created_at DESC);

CREATE TRIGGER trg_kpi_validation_periods_updated_at
  BEFORE UPDATE ON kpi_validation_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_validation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on kpi_validation_periods"
  ON kpi_validation_periods FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on kpi_validation_periods"
  ON kpi_validation_periods FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 5. 既存データを「デフォルトツリー」に移行 ─────────────────────────────────
-- ノードが存在するプロジェクトに対してデフォルトツリーを作成し、
-- 既存ノード・プリセットを紐づける

DO $$
DECLARE
  rec RECORD;
  tree_id uuid;
BEGIN
  -- ノードが存在するプロジェクトを列挙
  FOR rec IN
    SELECT DISTINCT project_id FROM project_kpi_tree_nodes WHERE kpi_tree_id IS NULL
  LOOP
    -- デフォルトツリーを INSERT（既に存在する場合はスキップ）
    INSERT INTO kpi_trees (project_id, name)
    VALUES (rec.project_id, 'デフォルトツリー')
    ON CONFLICT DO NOTHING
    RETURNING id INTO tree_id;

    -- INSERT が失敗（既存）の場合は SELECT で取得
    IF tree_id IS NULL THEN
      SELECT id INTO tree_id FROM kpi_trees
      WHERE project_id = rec.project_id
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    -- ノードを紐づけ
    UPDATE project_kpi_tree_nodes
    SET kpi_tree_id = tree_id
    WHERE project_id = rec.project_id AND kpi_tree_id IS NULL;

    -- プリセットを紐づけ
    UPDATE project_analysis_presets
    SET kpi_tree_id = tree_id
    WHERE project_id = rec.project_id AND kpi_tree_id IS NULL;
  END LOOP;

  -- プリセットだけ存在するプロジェクト（ノードなし）も対応
  FOR rec IN
    SELECT DISTINCT project_id FROM project_analysis_presets WHERE kpi_tree_id IS NULL
  LOOP
    INSERT INTO kpi_trees (project_id, name)
    VALUES (rec.project_id, 'デフォルトツリー')
    ON CONFLICT DO NOTHING
    RETURNING id INTO tree_id;

    IF tree_id IS NULL THEN
      SELECT id INTO tree_id FROM kpi_trees
      WHERE project_id = rec.project_id
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    UPDATE project_analysis_presets
    SET kpi_tree_id = tree_id
    WHERE project_id = rec.project_id AND kpi_tree_id IS NULL;
  END LOOP;
END;
$$;

-- ── 6. ノード変更時にプリセットを自動 stale 化するトリガー ───────────────────
-- ツリーのノードが更新・削除された際、同じ kpi_tree_id の
-- project_analysis_presets を is_stale = true にマークする

CREATE OR REPLACE FUNCTION fn_mark_presets_stale()
RETURNS TRIGGER AS $$
BEGIN
  -- UPDATE の場合は NEW / DELETE の場合は OLD の kpi_tree_id を使う
  UPDATE project_analysis_presets
  SET is_stale = true
  WHERE kpi_tree_id = COALESCE(NEW.kpi_tree_id, OLD.kpi_tree_id)
    AND is_stale = false;  -- 既に stale のものは触らない（updated_at を変えない）
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- UPDATE トリガー（metric_ref / service_id / parent_id / label の変更が対象）
CREATE OR REPLACE TRIGGER trg_node_update_mark_stale
  AFTER UPDATE OF metric_ref, service_id, parent_id, label, sort_order
  ON project_kpi_tree_nodes
  FOR EACH ROW
  WHEN (OLD.metric_ref IS DISTINCT FROM NEW.metric_ref
     OR OLD.service_id IS DISTINCT FROM NEW.service_id
     OR OLD.parent_id  IS DISTINCT FROM NEW.parent_id
     OR OLD.label      IS DISTINCT FROM NEW.label)
  EXECUTE FUNCTION fn_mark_presets_stale();

-- DELETE トリガー（ノード削除時）
CREATE OR REPLACE TRIGGER trg_node_delete_mark_stale
  AFTER DELETE
  ON project_kpi_tree_nodes
  FOR EACH ROW
  EXECUTE FUNCTION fn_mark_presets_stale();

-- INSERT トリガー（ノード追加時もツリー構造が変わるため stale 化）
CREATE OR REPLACE TRIGGER trg_node_insert_mark_stale
  AFTER INSERT
  ON project_kpi_tree_nodes
  FOR EACH ROW
  EXECUTE FUNCTION fn_mark_presets_stale();

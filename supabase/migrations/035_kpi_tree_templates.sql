-- ============================================================
-- 035_kpi_tree_templates.sql
-- KPIツリー「型（テンプレ）」を全クライアントで共通利用するための基盤
--
-- 方針:
-- - テンプレは client_id / project_id に紐づけない（グローバル）
-- - 必要に応じてプロジェクトへ「適用（複製）」して実体 kpi_trees / project_kpi_tree_nodes を作る
-- ============================================================

-- 1) テンプレ本体（グローバル）
CREATE TABLE IF NOT EXISTS kpi_tree_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    text        NOT NULL UNIQUE,  -- 人間が扱う一意キー（例: instagram_followers_v1）
  name            text        NOT NULL,
  description     text        DEFAULT NULL,
  -- service_type: 単一サービス種別向け / cross_service: 複数サービス横断
  scope           text        NOT NULL DEFAULT 'service_type' CHECK (scope IN ('service_type','cross_service')),
  target_industry text        DEFAULT NULL,      -- 例: restaurant（任意）
  version_no      int         NOT NULL DEFAULT 1,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_tree_templates_scope_active
  ON kpi_tree_templates (scope, is_active, created_at DESC);

CREATE TRIGGER trg_kpi_tree_templates_updated_at
  BEFORE UPDATE ON kpi_tree_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_tree_templates ENABLE ROW LEVEL SECURITY;

-- 読み取りはログインユーザーに許可（一覧表示・参照のため）
CREATE POLICY "authenticated users can read kpi_tree_templates"
  ON kpi_tree_templates FOR SELECT TO authenticated
  USING (true);

-- 変更は service_role のみに許可（運用: Supabase管理画面でSQLを流す想定）
CREATE POLICY "service_role full access on kpi_tree_templates"
  ON kpi_tree_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2) テンプレノード（親子構造）
CREATE TABLE IF NOT EXISTS kpi_tree_template_nodes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid        NOT NULL REFERENCES kpi_tree_templates(id) ON DELETE CASCADE,
  parent_id     uuid        REFERENCES kpi_tree_template_nodes(id) ON DELETE CASCADE,
  sort_order    int         NOT NULL DEFAULT 0,
  label         text        NOT NULL,
  node_type     text        NOT NULL CHECK (node_type IN ('folder','leaf')),

  -- 指標参照（第1フェーズ: service_type + metric_ref を基本）
  service_type  text        DEFAULT NULL, -- 例: instagram / gbp / line / lp（横断時に必須化も可）
  metric_ref    text        DEFAULT NULL, -- 例: ig_account_insight_fact.follower_count

  -- 横断テンプレで「どのサービスの値を使うか」などの選択戦略（将来拡張）
  service_selector jsonb    DEFAULT NULL,

  notes         text        DEFAULT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kpi_tree_template_nodes_leaf_ref_check
    CHECK (
      (node_type = 'leaf' AND metric_ref IS NOT NULL)
      OR (node_type = 'folder')
    )
);

CREATE INDEX IF NOT EXISTS idx_kpi_tree_template_nodes_template
  ON kpi_tree_template_nodes (template_id, sort_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kpi_tree_template_nodes_parent
  ON kpi_tree_template_nodes (parent_id);

CREATE TRIGGER trg_kpi_tree_template_nodes_updated_at
  BEFORE UPDATE ON kpi_tree_template_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE kpi_tree_template_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read kpi_tree_template_nodes"
  ON kpi_tree_template_nodes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "service_role full access on kpi_tree_template_nodes"
  ON kpi_tree_template_nodes FOR ALL TO service_role
  USING (true) WITH CHECK (true);


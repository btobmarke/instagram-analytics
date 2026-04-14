-- ============================================================
-- 036_apply_kpi_tree_template.sql
-- KPIツリーテンプレートをプロジェクトへ適用（複製）するSQL関数
--
-- 使い方（Supabase SQL editor）:
--   select apply_kpi_tree_template('PROJECT_UUID', 'template_key', null);
-- ============================================================

CREATE OR REPLACE FUNCTION apply_kpi_tree_template(
  p_project_id  uuid,
  p_template_key text,
  p_tree_name    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_template_id uuid;
  v_template_name text;
  v_tree_id uuid;
  rec record;
  v_new_id uuid;
  v_new_parent uuid;
  v_service_id uuid;
BEGIN
  SELECT id, name
    INTO v_template_id, v_template_name
  FROM kpi_tree_templates
  WHERE template_key = p_template_key
    AND is_active = true
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'template not found: %', p_template_key;
  END IF;

  -- ツリー作成
  INSERT INTO kpi_trees (project_id, name)
  VALUES (p_project_id, COALESCE(p_tree_name, v_template_name))
  RETURNING id INTO v_tree_id;

  -- ノードID対応表（テンプレID → 新規ノードID）
  CREATE TEMP TABLE IF NOT EXISTS tmp_kpi_tpl_node_map (
    template_node_id uuid PRIMARY KEY,
    new_node_id uuid NOT NULL
  ) ON COMMIT DROP;

  -- 親が先に来る順（depth昇順、同一階層は sort_order/created_at）
  FOR rec IN
    WITH RECURSIVE t AS (
      SELECT
        n.id, n.parent_id, n.sort_order, n.label, n.node_type,
        n.service_type, n.metric_ref, n.service_selector, n.created_at,
        0 AS depth
      FROM kpi_tree_template_nodes n
      WHERE n.template_id = v_template_id
        AND n.parent_id IS NULL

      UNION ALL

      SELECT
        c.id, c.parent_id, c.sort_order, c.label, c.node_type,
        c.service_type, c.metric_ref, c.service_selector, c.created_at,
        t.depth + 1
      FROM kpi_tree_template_nodes c
      JOIN t ON c.parent_id = t.id
      WHERE c.template_id = v_template_id
    )
    SELECT * FROM t
    ORDER BY depth ASC, sort_order ASC, created_at ASC
  LOOP
    -- 親ID解決
    v_new_parent := NULL;
    IF rec.parent_id IS NOT NULL THEN
      SELECT new_node_id INTO v_new_parent
      FROM tmp_kpi_tpl_node_map
      WHERE template_node_id = rec.parent_id;
    END IF;

    -- service_id 解決（leafで service_type があるとき、プロジェクト内で最初の該当サービスを採用）
    v_service_id := NULL;
    IF rec.node_type = 'leaf' AND rec.service_type IS NOT NULL THEN
      SELECT s.id INTO v_service_id
      FROM services s
      WHERE s.project_id = p_project_id
        AND s.service_type = rec.service_type
        AND s.is_active = true
        AND s.deleted_at IS NULL
      ORDER BY s.created_at ASC
      LIMIT 1;
    END IF;

    INSERT INTO project_kpi_tree_nodes (
      project_id,
      kpi_tree_id,
      parent_id,
      sort_order,
      label,
      node_type,
      metric_ref,
      service_id
    ) VALUES (
      p_project_id,
      v_tree_id,
      v_new_parent,
      COALESCE(rec.sort_order, 0),
      rec.label,
      rec.node_type,
      rec.metric_ref,
      v_service_id
    )
    RETURNING id INTO v_new_id;

    INSERT INTO tmp_kpi_tpl_node_map(template_node_id, new_node_id)
    VALUES (rec.id, v_new_id);
  END LOOP;

  RETURN v_tree_id;
END;
$$;


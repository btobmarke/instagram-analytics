-- ── サービスカスタム指標ライブラリ ──────────────────────────────────────────
-- summary_templates.custom_cards（テンプレート単位）から
-- service_custom_metrics（サービス単位ライブラリ）に昇格する

-- ── テーブル作成 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_custom_metrics (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  formula    jsonb       NOT NULL,   -- FormulaNode
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_custom_metrics_service_idx
  ON service_custom_metrics (service_id);

CREATE TRIGGER trg_service_custom_metrics_updated_at
  BEFORE UPDATE ON service_custom_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS（既存パターンと統一）
ALTER TABLE service_custom_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on service_custom_metrics"
  ON service_custom_metrics FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access on service_custom_metrics"
  ON service_custom_metrics FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 既存データ移行 ────────────────────────────────────────────────────────────
-- summary_templates.custom_cards から service_custom_metrics へ
-- rows の ID も新 UUID に書き換える

DO $$
DECLARE
  tmpl    RECORD;
  card    jsonb;
  old_id  text;
  new_id  uuid;
  id_map  jsonb := '{}'::jsonb;
BEGIN
  FOR tmpl IN
    SELECT st.id, st.service_id, st.custom_cards, st.rows
    FROM   summary_templates st
    WHERE  st.custom_cards IS NOT NULL
      AND  jsonb_array_length(st.custom_cards) > 0
  LOOP
    id_map := '{}'::jsonb;

    FOR card IN SELECT * FROM jsonb_array_elements(tmpl.custom_cards)
    LOOP
      old_id := card->>'id';

      -- 同一サービスで同名・同フォーミュラの指標が既にあれば再利用
      SELECT scm.id INTO new_id
      FROM   service_custom_metrics scm
      WHERE  scm.service_id = tmpl.service_id
        AND  scm.name       = card->>'label'
        AND  scm.formula    = card->'formula'
      LIMIT 1;

      IF new_id IS NULL THEN
        new_id := gen_random_uuid();
        INSERT INTO service_custom_metrics (id, service_id, name, formula)
        VALUES (new_id, tmpl.service_id, card->>'label', card->'formula');
      END IF;

      id_map := id_map || jsonb_build_object(old_id, new_id::text);
    END LOOP;

    -- rows の id を新 UUID に書き換え（formula は残さず削除）
    IF id_map != '{}'::jsonb THEN
      UPDATE summary_templates
      SET rows = (
        SELECT coalesce(jsonb_agg(
          CASE
            WHEN id_map ? (r->>'id')
            THEN (r - 'formula') || jsonb_build_object('id', id_map->>(r->>'id'))
            ELSE r
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(tmpl.rows) AS r
      )
      WHERE id = tmpl.id;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 提案資料テンプレート管理（ワイヤー/パーツ・スライド定義・デザインテンプレート）
-- ============================================================

-- ワイヤーまたはパーツ（HTML 本文を保持）
CREATE TABLE IF NOT EXISTS proposal_template_elements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  element_kind  TEXT        NOT NULL CHECK (element_kind IN ('wire', 'part')),
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  remarks       TEXT,
  html_content  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_template_elements_kind
  ON proposal_template_elements (element_kind);

-- スライド定義（ワイヤー1 + パーツ複数）
CREATE TABLE IF NOT EXISTS proposal_slide_layouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  remarks          TEXT,
  page_kind        TEXT        NOT NULL CHECK (page_kind IN ('cover', 'kpi', 'section')),
  wire_element_id  UUID        NOT NULL REFERENCES proposal_template_elements(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_slide_layouts_wire
  ON proposal_slide_layouts (wire_element_id);

CREATE TABLE IF NOT EXISTS proposal_slide_layout_parts (
  slide_layout_id UUID NOT NULL REFERENCES proposal_slide_layouts(id) ON DELETE CASCADE,
  part_element_id UUID NOT NULL REFERENCES proposal_template_elements(id) ON DELETE RESTRICT,
  sort_order      INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (slide_layout_id, part_element_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_slide_layout_parts_layout
  ON proposal_slide_layout_parts (slide_layout_id);

-- デザインテンプレート（登録スライドを順序付きで束ねる）
CREATE TABLE IF NOT EXISTS proposal_design_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  tags       TEXT[]      NOT NULL DEFAULT '{}',
  remarks    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_design_template_slides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_template_id  UUID NOT NULL REFERENCES proposal_design_templates(id) ON DELETE CASCADE,
  slide_layout_id     UUID NOT NULL REFERENCES proposal_slide_layouts(id) ON DELETE RESTRICT,
  sort_order          INT  NOT NULL,
  UNIQUE (design_template_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_proposal_design_template_slides_template
  ON proposal_design_template_slides (design_template_id);

-- Triggers
CREATE TRIGGER update_proposal_template_elements_updated_at
  BEFORE UPDATE ON proposal_template_elements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proposal_slide_layouts_updated_at
  BEFORE UPDATE ON proposal_slide_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proposal_design_templates_updated_at
  BEFORE UPDATE ON proposal_design_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE proposal_template_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_slide_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_slide_layout_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_design_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_design_template_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full proposal_template_elements"
  ON proposal_template_elements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role full proposal_template_elements"
  ON proposal_template_elements FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full proposal_slide_layouts"
  ON proposal_slide_layouts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role full proposal_slide_layouts"
  ON proposal_slide_layouts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full proposal_slide_layout_parts"
  ON proposal_slide_layout_parts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role full proposal_slide_layout_parts"
  ON proposal_slide_layout_parts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full proposal_design_templates"
  ON proposal_design_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role full proposal_design_templates"
  ON proposal_design_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full proposal_design_template_slides"
  ON proposal_design_template_slides FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role full proposal_design_template_slides"
  ON proposal_design_template_slides FOR ALL TO service_role USING (true) WITH CHECK (true);

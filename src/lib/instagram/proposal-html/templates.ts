/**
 * 案A: レイアウトワイヤー ID とパーツ（スロット）の対応。
 * ページ種別（cover / kpi / section）ごとにワイヤーを切り替え可能。
 */

export type HtmlLayoutWireId = 'A_cover_center' | 'B_kpi_table' | 'C_kpi_split' | 'F_section_standard' | 'G_section_magazine'

export interface HtmlTemplatePageRule {
  pageKind: 'cover' | 'kpi' | 'section'
  wireId: HtmlLayoutWireId
  /** UI 用: このページに含まれるパーツ */
  parts: { id: string; label: string }[]
}

export interface ProposalHtmlTemplateDef {
  id: string
  name: string
  description: string
  /** ページ種別ごとのワイヤー割当 */
  rules: {
    cover: HtmlTemplatePageRule
    kpi: HtmlTemplatePageRule
    section: HtmlTemplatePageRule
  }
}

const PARTS_COVER = [
  { id: 'title', label: 'タイトル' },
  { id: 'subtitle', label: 'サブタイトル' },
]
const PARTS_KPI = [
  { id: 'heading', label: '見出し' },
  { id: 'chart_table', label: 'グラフ相当（表）' },
]
const PARTS_SECTION = [
  { id: 'title', label: '見出し' },
  { id: 'body', label: '本文' },
  { id: 'bullets', label: '箇条書き' },
]

export const PROPOSAL_HTML_TEMPLATES: Record<string, ProposalHtmlTemplateDef> = {
  classic: {
    id: 'classic',
    name: 'クラシック',
    description: '表紙は中央配置（ワイヤーA）。KPI は見出し＋下に表（ワイヤーB）。章は標準（ワイヤーF）。',
    rules: {
      cover: { pageKind: 'cover', wireId: 'A_cover_center', parts: PARTS_COVER },
      kpi: { pageKind: 'kpi', wireId: 'B_kpi_table', parts: PARTS_KPI },
      section: { pageKind: 'section', wireId: 'F_section_standard', parts: PARTS_SECTION },
    },
  },
  magazine: {
    id: 'magazine',
    name: 'マガジン',
    description: '表紙は同じ（A）。KPI は左見出し・右表の2カラム（ワイヤーC）。章は見出し帯＋本文（ワイヤーG）。',
    rules: {
      cover: { pageKind: 'cover', wireId: 'A_cover_center', parts: PARTS_COVER },
      kpi: { pageKind: 'kpi', wireId: 'C_kpi_split', parts: PARTS_KPI },
      section: { pageKind: 'section', wireId: 'G_section_magazine', parts: PARTS_SECTION },
    },
  },
}

export const DEFAULT_HTML_TEMPLATE_ID = 'classic'

export function listHtmlTemplates(): ProposalHtmlTemplateDef[] {
  return Object.values(PROPOSAL_HTML_TEMPLATES)
}

export function getHtmlTemplate(id: string): ProposalHtmlTemplateDef {
  return PROPOSAL_HTML_TEMPLATES[id] ?? PROPOSAL_HTML_TEMPLATES[DEFAULT_HTML_TEMPLATE_ID]
}

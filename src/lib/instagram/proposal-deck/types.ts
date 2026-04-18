import type { ProposalOutline } from '@/lib/instagram/proposal-schemas'

/** テンプレ v1: 構成案から展開されるページ計画 */
export type ProposalDeckPagePlan =
  | { pageKey: 'cover'; hint: string }
  | { pageKey: 'kpi'; hint: string }
  | { pageKey: 'section'; sectionId: string; sectionTitle: string; hint: string }

export function buildDeckPagePlans(outline: ProposalOutline): ProposalDeckPagePlan[] {
  const plans: ProposalDeckPagePlan[] = [
    { pageKey: 'cover', hint: '資料の表紙。document_title と想定読者・期間を subtitle に含める' },
    {
      pageKey: 'kpi',
      hint: '要約に出ている主要指標のみを metric_rows に。捏造しない',
    },
  ]
  for (const sec of outline.sections) {
    plans.push({
      pageKey: 'section',
      sectionId: sec.id,
      sectionTitle: sec.title,
      hint: `章「${sec.title}」。purpose と key_points を本文・箇条書きに反映`,
    })
  }
  return plans
}

export type CoverSlots = { title: string; subtitle: string }
export type KpiSlots = { title: string; metric_rows: { label: string; value: string }[] }
export type SectionSlots = { title: string; body: string; bullets: string[] }

export type ProposalDeckSlide =
  | { pageKey: 'cover'; slots: CoverSlots }
  | { pageKey: 'kpi'; slots: KpiSlots }
  | { pageKey: 'section'; sectionId: string; slots: SectionSlots }

export interface ProposalDeckContent {
  version: 1
  documentTitle: string
  slides: ProposalDeckSlide[]
}

import { z } from 'zod'

const coverSlotsSchema = z.object({
  title: z.string().max(500),
  subtitle: z.string().max(800),
})

const kpiSlotsSchema = z.object({
  title: z.string().max(200),
  metric_rows: z.array(z.object({ label: z.string().max(120), value: z.string().max(120) })).max(20),
})

const sectionSlotsSchema = z.object({
  title: z.string().max(200),
  body: z.string().max(4000),
  bullets: z.array(z.string().max(500)).max(15),
})

export const proposalDeckSlideSchema = z.discriminatedUnion('pageKey', [
  z.object({ pageKey: z.literal('cover'), slots: coverSlotsSchema }),
  z.object({ pageKey: z.literal('kpi'), slots: kpiSlotsSchema }),
  z.object({
    pageKey: z.literal('section'),
    sectionId: z.string().min(1).max(64),
    slots: sectionSlotsSchema,
  }),
])

export const proposalDeckContentSchema = z.object({
  version: z.literal(1),
  documentTitle: z.string().min(1).max(200),
  slides: z.array(proposalDeckSlideSchema).min(1).max(30),
})

export type ProposalDeckContentParsed = z.infer<typeof proposalDeckContentSchema>
export type ProposalDeckSlideParsed = z.infer<typeof proposalDeckSlideSchema>

export function parseProposalDeckJson(raw: string): { ok: true; data: ProposalDeckContentParsed } | { ok: false; error: string } {
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(text)
  if (fence) text = fence[1].trim()
  try {
    const parsed = JSON.parse(text) as unknown
    const result = proposalDeckContentSchema.safeParse(parsed)
    if (!result.success) {
      return { ok: false, error: result.error.message }
    }
    return { ok: true, data: result.data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'JSON の解析に失敗しました' }
  }
}

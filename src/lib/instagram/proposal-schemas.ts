import { z } from 'zod'

/** LLM が返す提案資料の構成案 */
export const proposalOutlineSectionSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  purpose: z.string().max(800).optional(),
  key_points: z.array(z.string().max(400)).max(10).optional(),
})

export const proposalOutlineSchema = z.object({
  document_title: z.string().min(1).max(200),
  audience: z.string().max(400).optional(),
  sections: z.array(proposalOutlineSectionSchema).min(3).max(10),
})

export type ProposalOutline = z.infer<typeof proposalOutlineSchema>

export function parseProposalOutlineJson(raw: string): { ok: true; data: ProposalOutline } | { ok: false; error: string } {
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(text)
  if (fence) text = fence[1].trim()
  try {
    const parsed = JSON.parse(text) as unknown
    const result = proposalOutlineSchema.safeParse(parsed)
    if (!result.success) {
      return { ok: false, error: result.error.message }
    }
    return { ok: true, data: result.data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'JSON の解析に失敗しました' }
  }
}

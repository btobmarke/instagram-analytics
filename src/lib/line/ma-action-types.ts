import { z } from 'zod'

/** ルールの actions 配列の各要素（v1） */
export const MaActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tag_id: z.string().uuid() }),
  z.object({
    type: z.literal('set_attribute'),
    definition_id: z.string().uuid(),
    value_text: z.string().min(1).max(4000),
  }),
  z.object({ type: z.literal('start_scenario'), scenario_id: z.string().uuid() }),
  z.object({
    type: z.literal('enqueue_broadcast'),
    template_id: z.string().uuid(),
    /** ISO 8601 省略時は即時 */
    scheduled_at: z.string().optional(),
  }),
])

export type MaAction = z.infer<typeof MaActionSchema>

export const MaActionsSchema = z.array(MaActionSchema)

export function parseMaActions(raw: unknown): MaAction[] {
  const parsed = MaActionsSchema.safeParse(raw)
  return parsed.success ? parsed.data : []
}

import { z } from 'zod'

/** セグメント定義（タグ AND/OR/NOT + 属性条件 + 友だち絞り） */
export const SegmentDefinitionSchema = z
  .object({
    follow_status: z.enum(['followed_only', 'all']).optional().default('followed_only'),
    tag_ids_any: z.array(z.string().uuid()).optional(),
    tag_ids_all: z.array(z.string().uuid()).optional(),
    tag_ids_none: z.array(z.string().uuid()).optional(),
    attribute_filters: z
      .array(
        z.object({
          definition_id: z.string().uuid(),
          op: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte']),
          value: z.string(),
        }),
      )
      .optional(),
  })
  .strict()

export type SegmentDefinition = z.infer<typeof SegmentDefinitionSchema>

import { z } from 'zod'

const OperandTimeOpSchema = z.enum(['none', 'lag1', 'diff_prev'])

export const FormulaStepSchema = z.object({
  operator: z.enum(['+', '-', '*', '/', 'min', 'max', 'coalesce']),
  operandId: z.string().min(1),
  operandIsConst: z.boolean().optional(),
  operandTimeOp: OperandTimeOpSchema.optional(),
  extraOperandIds: z.array(z.string().min(1)).max(20).optional(),
  extraOperandsAreConst: z.array(z.boolean()).max(20).optional(),
})

const FormulaConditionalAggregateSchema = z.object({
  definitionId: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()),
})

export const FormulaNodeSchema = z.object({
  baseOperandId: z.string().min(1),
  baseOperandIsConst: z.boolean().optional(),
  baseTimeOp: OperandTimeOpSchema.optional(),
  steps: z.array(FormulaStepSchema),
  thresholdMode: z.enum(['none', 'gte', 'lte']).optional(),
  thresholdValue: z.number().nullable().optional(),
  conditionalAggregate: FormulaConditionalAggregateSchema.optional().nullable(),
  cumulativeUsersSliceRef: z.string().min(1).max(200).optional().nullable(),
})

export type FormulaNodeParsed = z.infer<typeof FormulaNodeSchema>

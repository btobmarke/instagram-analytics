/** クライアント選択用・検証用（@ai-sdk 非依存でクライアントからも import 可） */

export const DEFAULT_AI_MODEL_ID = 'claude-sonnet-4-6' as const

export const AI_MODEL_OPTION_IDS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-6',
] as const

export type AiModelOptionId = (typeof AI_MODEL_OPTION_IDS)[number]

export const AI_MODEL_OPTIONS: {
  id: AiModelOptionId
  label: string
  description: string
}[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'バランス型（既定）',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: '高速・低コスト',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    description: '最高品質寄り',
  },
]

export function isAiModelOptionId(s: string): s is AiModelOptionId {
  return (AI_MODEL_OPTION_IDS as readonly string[]).includes(s)
}

export function normalizeAiModelId(s: string | null | undefined): AiModelOptionId {
  if (s && isAiModelOptionId(s)) return s
  return DEFAULT_AI_MODEL_ID
}

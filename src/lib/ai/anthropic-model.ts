import { anthropic } from '@ai-sdk/anthropic'
import type { AiModelOptionId } from './model-options'

export function anthropicLanguageModel(modelId: AiModelOptionId) {
  return anthropic(modelId)
}

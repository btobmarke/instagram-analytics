import { anthropicLanguageModel } from './anthropic-model'
import { DEFAULT_AI_MODEL_ID } from './model-options'

/** クライアント未特定時・後方互換用の既定モデル（Vercel AI SDK） */
export const AI_MODEL = anthropicLanguageModel(DEFAULT_AI_MODEL_ID)

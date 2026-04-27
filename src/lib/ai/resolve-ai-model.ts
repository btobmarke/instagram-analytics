import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeAiModelId, type AiModelOptionId } from './model-options'

type ClientsRow = { ai_model: string | null }

type ServiceJoinRow = {
  projects:
    | {
        clients: ClientsRow | null
      }
    | {
        clients: ClientsRow | null
      }[]
    | null
}

function pickClientAiModel(projects: ServiceJoinRow['projects']): AiModelOptionId {
  if (!projects) return normalizeAiModelId(null)
  const p = Array.isArray(projects) ? projects[0] : projects
  const raw = p?.clients?.ai_model
  return normalizeAiModelId(raw)
}

/** Instagram サービス ID → 紐づくクライアントの ai_model */
export async function getAiModelIdForServiceId(
  supabase: SupabaseClient,
  serviceId: string
): Promise<AiModelOptionId> {
  const { data, error } = await supabase
    .from('services')
    .select(
      `
      projects!inner (
        clients!inner ( ai_model )
      )
    `
    )
    .eq('id', serviceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return normalizeAiModelId(null)
  return pickClientAiModel((data as unknown as ServiceJoinRow).projects)
}

type AccountJoinRow = {
  service_id: string | null
  services: ServiceJoinRow | null
}

/** ig_accounts.id → サービス経由でクライアントの ai_model（未連携時は既定） */
export async function getAiModelIdForAccountId(
  supabase: SupabaseClient,
  accountId: string
): Promise<AiModelOptionId> {
  const { data, error } = await supabase
    .from('ig_accounts')
    .select(
      `
      service_id,
      services (
        projects!inner (
          clients!inner ( ai_model )
        )
      )
    `
    )
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) return normalizeAiModelId(null)

  const row = data as AccountJoinRow
  if (!row.service_id || !row.services) return normalizeAiModelId(null)

  return pickClientAiModel((row.services as unknown as ServiceJoinRow).projects)
}

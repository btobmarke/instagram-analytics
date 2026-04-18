import { createSupabaseServerClient } from '@/lib/supabase/server'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export async function assertLineService(
  supabase: ServerClient,
  serviceId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const { data: service, error } = await supabase
    .from('services')
    .select('id, service_type')
    .eq('id', serviceId)
    .maybeSingle()
  if (error || !service) return { ok: false, status: 404, body: { error: 'not_found' } }
  if (service.service_type !== 'line') {
    return { ok: false, status: 400, body: { error: 'not_a_line_service' } }
  }
  return { ok: true }
}

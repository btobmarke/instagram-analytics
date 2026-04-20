import type { SupabaseClient } from '@supabase/supabase-js'

export type FunnelStepStats = {
  step_index: number
  trigger_type: string
  contacts_reached: number
}

/**
 * G4: コンタクトごとに、定義された trigger_type を時系列順（最大 gap 以内）に踏んだ人数
 */
export async function buildFunnelReport(
  admin: SupabaseClient,
  serviceId: string,
  funnelId: string,
): Promise<{ data: { steps: FunnelStepStats[]; funnel_name: string } | null; error?: string }> {
  const { data: funnel, error: fErr } = await admin
    .from('line_messaging_funnels')
    .select('name, steps, max_step_gap_hours')
    .eq('id', funnelId)
    .eq('service_id', serviceId)
    .maybeSingle()

  if (fErr) return { data: null, error: fErr.message }
  if (!funnel) return { data: null, error: 'not_found' }

  const rawSteps = funnel.steps
  const stepTypes = Array.isArray(rawSteps)
    ? rawSteps.map((x) => String(x).trim()).filter(Boolean)
    : []

  if (stepTypes.length === 0) {
    return { data: { funnel_name: funnel.name, steps: [] } }
  }

  const gapMs = Math.max(1, (funnel.max_step_gap_hours ?? 168) * 3600 * 1000)

  const { data: contacts, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('service_id', serviceId)

  if (cErr) return { data: null, error: cErr.message }

  const stats: FunnelStepStats[] = stepTypes.map((trigger_type, step_index) => ({
    step_index,
    trigger_type,
    contacts_reached: 0,
  }))

  for (const c of contacts ?? []) {
    const { data: evs, error: eErr } = await admin
      .from('line_messaging_events')
      .select('trigger_type, occurred_at')
      .eq('service_id', serviceId)
      .eq('contact_id', c.id)
      .order('occurred_at', { ascending: true })

    if (eErr) return { data: null, error: eErr.message }

    const byType = new Map<string, number[]>()
    for (const ev of evs ?? []) {
      const t = Date.parse(ev.occurred_at)
      if (Number.isNaN(t)) continue
      const arr = byType.get(ev.trigger_type) ?? []
      arr.push(t)
      byType.set(ev.trigger_type, arr)
    }

    let lastTime: number | null = null
    let completedThrough = -1
    for (let i = 0; i < stepTypes.length; i++) {
      const want = stepTypes[i]
      const times = (byType.get(want) ?? []).sort((a, b) => a - b)
      const pick = times.find((ts) => {
        if (lastTime === null) return true
        return ts >= lastTime && ts - lastTime <= gapMs
      })
      if (pick === undefined) break
      lastTime = pick
      completedThrough = i
    }
    for (let i = 0; i <= completedThrough; i++) {
      stats[i].contacts_reached++
    }
  }

  return { data: { funnel_name: funnel.name, steps: stats } }
}

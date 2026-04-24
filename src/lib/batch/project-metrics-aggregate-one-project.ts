import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMetricsByRefs, buildPeriods } from '@/lib/summary/fetch-metrics'
import { getMetricCatalogForProjectAggregate } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

/**
 * 1 プロジェクト配下のアクティブサービスについて project_metrics_daily を更新。
 */
export async function runProjectMetricsAggregateForProject(
  admin: SupabaseClient,
  projectId: string,
  targetDate: string
): Promise<{ services: number; upserted: number; errors: number }> {
  const { data: services, error: svcErr } = await admin
    .from('services')
    .select('id, service_name, service_type, project_id')
    .is('deleted_at', null)
    .eq('is_active', true)
    .eq('project_id', projectId)

  if (svcErr || !services) {
    throw new Error(svcErr?.message ?? 'services fetch failed')
  }

  const targetPeriods = (() => {
    const p = buildPeriods('custom_range', 1, targetDate, targetDate)
    if ('error' in p) throw new Error(p.error)
    return p
  })()

  let totalUpserted = 0
  let totalErrors = 0

  for (const svc of services) {
    try {
      const catalog = getMetricCatalogForProjectAggregate(svc.service_type)
      if (catalog.length === 0) continue

      const fieldRefs = catalog.map(c => c.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawData = await fetchMetricsByRefs(admin as any, svc.id, fieldRefs, targetPeriods)

      const periodLabel = targetPeriods[0].label
      const upsertRows = fieldRefs
        .map(ref => ({
          project_id: svc.project_id,
          service_id: svc.id,
          date: targetDate,
          metric_ref: ref,
          value: rawData[ref]?.[periodLabel] ?? null,
          updated_at: new Date().toISOString(),
        }))
        .filter(row => row.value !== null)

      if (upsertRows.length === 0) continue

      const CHUNK = 500
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const chunk = upsertRows.slice(i, i + CHUNK)
        const { error: upsertErr } = await admin
          .from('project_metrics_daily')
          .upsert(chunk, { onConflict: 'project_id,service_id,date,metric_ref' })

        if (upsertErr) {
          console.error(`[project-metrics-aggregate] upsert error svc=${svc.id}:`, upsertErr)
          totalErrors++
        } else {
          totalUpserted += chunk.length
        }
      }
    } catch (e) {
      console.error(`[project-metrics-aggregate] service=${svc.id} error:`, e)
      totalErrors++
    }
  }

  return { services: services.length, upserted: totalUpserted, errors: totalErrors }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'
import type { InstagramServiceKpi } from '@/types'

/**
 * Instagram サービス詳細「KPI設定」（instagram_service_kpis）を AI プロンプト用テキストに整形する。
 * @param prioritizeServiceKpis false のときは「参考」扱いの指示文にし、主軸に据えないよう促す。
 */
export async function buildInstagramServiceKpiPromptBlock(
  supabase: SupabaseClient,
  accountId: string,
  prioritizeServiceKpis = true,
): Promise<string> {
  const { data: acct } = await supabase
    .from('ig_accounts')
    .select('service_id')
    .eq('id', accountId)
    .maybeSingle()

  if (!acct?.service_id) {
    return '（Instagram サービスに紐づいていないため、サービスKPI設定は参照できません。）'
  }

  const { data: rows, error } = await supabase
    .from('instagram_service_kpis')
    .select('*')
    .eq('service_id', acct.service_id)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return `（サービスKPIの取得に失敗しました: ${error.message}）`
  }

  const list = (rows ?? []) as InstagramServiceKpi[]
  if (list.length === 0) {
    return '（サービス詳細の「KPI設定」にまだ登録がありません。サマリー指標のみを根拠に評価してください。）'
  }

  const catalog = getMetricCatalog('instagram')
  const catalogById = new Map(catalog.map((c) => [c.id, c.label]))

  const customIds = list
    .filter((r) => r.card_type === 'custom_card' && r.card_ref)
    .map((r) => r.card_ref as string)

  const customNames = new Map<string, string>()
  if (customIds.length > 0) {
    const { data: customs } = await supabase
      .from('service_custom_metrics')
      .select('id, name')
      .eq('service_id', acct.service_id)
      .in('id', customIds)
    for (const c of customs ?? []) {
      customNames.set(c.id, c.name)
    }
  }

  const lines: string[] = []
  lines.push(
    prioritizeServiceKpis
      ? '以下はこのサービスで設定された KPI です。各項目の「目標値」と「紐づく指標」を踏まえ、分析期間のサマリーと照らし合わせて優先的に評価・コメントしてください。'
      : '以下はこのサービスで登録されている KPI の一覧です。分析ではこれらを主軸に据えず、サマリーや全体傾向を優先してください。必要に応じて軽く触れる程度で構いません。',
  )
  for (const r of list) {
    const ref = r.card_ref?.trim() ?? ''
    const refLabel =
      r.card_type === 'metric_card'
        ? (ref ? catalogById.get(ref) ?? ref : '—')
        : ref
          ? `カスタム指標「${customNames.get(ref) ?? ref}」`
          : '—'
    const desc = r.kpi_description?.trim() ? ` / 説明: ${r.kpi_description.trim()}` : ''
    lines.push(
      `- フェーズ ${r.phase} | ${r.kpi_name} | 目標値: ${r.target_value.toLocaleString('ja-JP')} | 指標: ${refLabel}${desc}`,
    )
  }
  return lines.join('\n')
}

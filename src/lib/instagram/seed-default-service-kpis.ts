import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

const IG = 'ig_account_insight_fact'

/**
 * サイドバー「設定」の KPI 目標値（簡易）6項目に相当する、サービス詳細 KPI の初期行。
 * 指標カードはアカウント日次インサイト（サマリーと同一カタログ）に紐づける。
 */
const DEFAULT_ROWS: Array<{
  phase: number
  kpi_name: string
  target_value: number
  card_ref: string
  kpi_description: string
}> = [
  {
    phase: 1,
    kpi_name: '目標フォロワー数',
    target_value: 10_000,
    card_ref: `${IG}.follower_count`,
    kpi_description:
      'アカウント全体のフォロワー人数の目標（設定画面の「目標フォロワー数」に相当）。',
  },
  {
    phase: 1,
    kpi_name: '目標エンゲージメント率',
    target_value: 500,
    card_ref: `${IG}.accounts_engaged`,
    kpi_description:
      '※率(%)そのものは日次カードにないため、エンゲージしたアカウント数の目標値として置いています（旧「目標エンゲージメント率」の代替）。率はサマリーから算出して照合してください。',
  },
  {
    phase: 1,
    kpi_name: '目標リーチ数/投稿',
    target_value: 500,
    card_ref: `${IG}.reach`,
    kpi_description:
      '日次リーチの目安です。投稿あたりに換算する場合は、分析期間の投稿本数で除算してください（設定画面の「目標リーチ数/投稿」に相当）。',
  },
  {
    phase: 1,
    kpi_name: '目標保存数/投稿',
    target_value: 50,
    card_ref: `${IG}.saves`,
    kpi_description:
      '日次保存数の目安です。投稿あたりに換算する場合は投稿本数で除算してください。',
  },
  {
    phase: 1,
    kpi_name: '目標投稿頻度/週',
    target_value: 3,
    card_ref: `${IG}.views`,
    kpi_description:
      '※週の投稿本数専用の指標カードがないため、閲覧数(views)を活動・露出の目安として置いています。実際の週次投稿数は別途把握し、必要ならカスタム指標に差し替えてください。',
  },
  {
    phase: 1,
    kpi_name: '目標月次フォロワー増加',
    target_value: 300,
    card_ref: `${IG}.follower_count`,
    kpi_description:
      '月初〜月末のフォロワー純増の目標（人）。カード値はスナップショットのため、期間比較で評価してください。',
  },
]

function assertCatalogRefs() {
  const ids = new Set(getMetricCatalog('instagram').map((c) => c.id))
  for (const r of DEFAULT_ROWS) {
    if (!ids.has(r.card_ref)) {
      throw new Error(`[seedDefaultInstagramServiceKpis] カタログに存在しない card_ref: ${r.card_ref}`)
    }
  }
}

/**
 * 当該サービスに KPI 行が1件もなければ、基本6項目を挿入する。
 * @returns 挿入した件数（0＝既に行があった／スキップ）
 */
export async function seedDefaultInstagramServiceKpisIfEmpty(
  supabase: SupabaseClient,
  serviceId: string,
): Promise<{ inserted: number }> {
  assertCatalogRefs()

  const { count, error: countErr } = await supabase
    .from('instagram_service_kpis')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', serviceId)

  if (countErr) {
    console.error('[seedDefaultInstagramServiceKpisIfEmpty] count error:', countErr)
    return { inserted: 0 }
  }
  if ((count ?? 0) > 0) {
    return { inserted: 0 }
  }

  const now = new Date().toISOString()
  const rows = DEFAULT_ROWS.map((r, i) => ({
    service_id: serviceId,
    phase: r.phase,
    kpi_name: r.kpi_name,
    target_value: r.target_value,
    card_type: 'metric_card' as const,
    card_ref: r.card_ref,
    kpi_description: r.kpi_description,
    display_order: i,
    updated_at: now,
  }))

  const { error: insErr } = await supabase.from('instagram_service_kpis').insert(rows)
  if (insErr) {
    console.error('[seedDefaultInstagramServiceKpisIfEmpty] insert error:', insErr)
    return { inserted: 0 }
  }

  return { inserted: rows.length }
}

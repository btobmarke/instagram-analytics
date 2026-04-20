import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

const IG = 'ig_account_insight_fact'

/**
 * サービス詳細 KPI の初期行（従来6件 + 算出KPI5件）。
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
  {
    phase: 1,
    kpi_name: 'ホーム率（目安）',
    target_value: 50,
    card_ref: `${IG}@formula:kpi_home_rate_proxy`,
    kpi_description:
      'プロフィール閲覧 ÷ 閲覧（フォロワー内訳）の日次%（投稿別ホーム÷フォロワービューに近い目安）。月平均 50% 以上を目安にする場合は目標 50。',
  },
  {
    phase: 1,
    kpi_name: '保存率',
    target_value: 2,
    card_ref: `${IG}@formula:kpi_save_rate`,
    kpi_description: '保存数 ÷ リーチ（日次%）。各投稿の保存率の月平均 2% 以上を目安にする場合は目標 2。',
  },
  {
    phase: 1,
    kpi_name: 'プロフィールアクセス率',
    target_value: 2,
    card_ref: `${IG}@formula:kpi_profile_access_rate`,
    kpi_description: 'プロフィール閲覧 ÷ リーチ（日次%）。月平均 2% 以上を目安にする場合は目標 2。',
  },
  {
    phase: 1,
    kpi_name: 'フォロー率（期間合算）',
    target_value: 5,
    card_ref: `${IG}@formula:kpi_follow_rate_30d`,
    kpi_description:
      '期間内フォロワー純増 ÷ 期間内プロフィール閲覧合計（%）。サマリーで単一期間（例: 直近30日）を選ぶと値が入ります。月平均 5% 以上を目安にする場合は目標 5。',
  },
  {
    phase: 1,
    kpi_name: 'リンククリック率（期間合算）',
    target_value: 5,
    card_ref: `${IG}@formula:kpi_link_click_rate_30d`,
    kpi_description:
      '期間内プロフィールリンクタップ合計 ÷ プロフィール閲覧合計（%）。単一期間のときのみ値が入ります。月平均 5% 以上を目安にする場合は目標 5。',
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
 * 当該サービスに KPI 行が1件もなければ、基本項目を挿入する。
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

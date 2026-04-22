/**
 * GET /api/projects/[projectId]/unified-summary
 *
 * プロジェクト横断サマリー。
 *
 * キャッシュ戦略:
 *   - project_metrics_daily にキャッシュがある日 → キャッシュから返す（高速）
 *   - キャッシュがない日（今日・未集計）        → fetchMetricsByRefs でリアルタイム取得
 *
 * Query params:
 *   timeUnit    day | week | month | custom_range (default: day)
 *   count       期間数 (default: 14, max: 90)
 *   rangeStart  YYYY-MM-DD (custom_range 時必須)
 *   rangeEnd    YYYY-MM-DD (custom_range 時必須)
 *   nocache     "1" にするとキャッシュを無視してリアルタイム取得（デバッグ用）
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildPeriods,
  fetchMetricsByRefs,
} from '@/lib/summary/fetch-metrics'
import type { TimeUnit, Period } from '@/lib/summary/fetch-metrics'
import { getMetricCatalogForProjectAggregate } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

// ── 型 ──────────────────────────────────────────────────────────────────────

type MetricValues = Record<string, number | null>  // { periodLabel: value }

interface ServiceResult {
  id:          string
  name:        string
  serviceType: string
  metrics:     Record<string, { label: string; category: string; values: MetricValues }>
}

// ── キャッシュ読み取り ────────────────────────────────────────────────────────

/**
 * project_metrics_daily から指定期間のキャッシュを取得する。
 * 返却: { serviceId: { metricRef: { dateStr: value } } }
 */
async function readCache(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  serviceIds: string[],
  dateKeys: string[],  // YYYY-MM-DD の配列
): Promise<Map<string, Map<string, Map<string, number | null>>>> {
  // Map<serviceId, Map<metricRef, Map<dateKey, value>>>
  const result = new Map<string, Map<string, Map<string, number | null>>>()
  if (serviceIds.length === 0 || dateKeys.length === 0) return result

  const fromDate = [...dateKeys].sort()[0]
  const toDate   = [...dateKeys].sort()[dateKeys.length - 1]

  const { data: rows } = await supabase
    .from('project_metrics_daily')
    .select('service_id, date, metric_ref, value')
    .eq('project_id', projectId)
    .in('service_id', serviceIds)
    .gte('date', fromDate)
    .lte('date', toDate)

  for (const row of rows ?? []) {
    const svcId    = row.service_id as string
    const dateKey  = String(row.date).slice(0, 10)
    const ref      = row.metric_ref as string
    const val      = row.value as number | null

    if (!result.has(svcId)) result.set(svcId, new Map())
    const byRef = result.get(svcId)!
    if (!byRef.has(ref)) byRef.set(ref, new Map())
    byRef.get(ref)!.set(dateKey, val)
  }

  return result
}

// ── ヘルパー ─────────────────────────────────────────────────────────────────

/** JST 今日 YYYY-MM-DD */
function jstToday(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

/** Period の dateKey（YYYY-MM-DD）を返す。day 単位のみ有効 */
function periodDateKey(p: Period): string | null {
  return p.dateKey ?? null
}

// ── メインハンドラ ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // プロジェクト存在チェック
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'プロジェクトが見つかりません' } },
      { status: 404 },
    )
  }

  // クエリパラメータ解析
  const url             = new URL(req.url)
  const timeUnit        = (url.searchParams.get('timeUnit') ?? 'day') as TimeUnit
  const count           = Math.min(parseInt(url.searchParams.get('count') ?? '14', 10), 90)
  const rangeStartParam = url.searchParams.get('rangeStart')?.slice(0, 10)
  const rangeEndParam   = url.searchParams.get('rangeEnd')?.slice(0, 10)
  const noCache         = url.searchParams.get('nocache') === '1'

  // 期間生成
  const periodsOrError = buildPeriods(timeUnit, count, rangeStartParam, rangeEndParam)
  if ('error' in periodsOrError) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: periodsOrError.error } },
      { status: 400 },
    )
  }
  const periods = periodsOrError

  // アクティブサービス一覧取得
  const { data: services, error: svcError } = await supabase
    .from('services')
    .select('id, service_name, service_type')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (svcError) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: svcError.message } },
      { status: 500 },
    )
  }

  if (!services || services.length === 0) {
    return NextResponse.json({
      success: true,
      data: { periods: periods.map(p => p.label), services: [] },
    })
  }

  // ── キャッシュ戦略の判定 ────────────────────────────────────────────────
  //
  // day 単位のとき:
  //   - JST 今日 は常にリアルタイム取得（バッチ未実行のため）
  //   - 昨日以前はキャッシュ優先。ただしサービス単位で判定:
  //       * そのサービスに non-null キャッシュエントリが 1件もない日
  //         → そのサービスのみリアルタイム取得に回す
  //       * null キャッシュが存在する場合もリアルタイムにフォールバック
  //         （aggregate バッチ失敗日の stale null を読まないようにするため）
  //
  // week / month / custom_range のとき:
  //   - 集計済みキャッシュがないのでリアルタイム取得

  const today = jstToday()
  const isDayUnit = timeUnit === 'day'

  // 今日は全サービス共通でリアルタイム、それ以外はキャッシュ候補
  const cachedDateKeys: string[] = []
  const globalRealtimePeriods: Period[] = []  // 全サービス共通のリアルタイム期間

  if (isDayUnit && !noCache) {
    for (const p of periods) {
      const dk = periodDateKey(p)
      if (dk && dk !== today) {
        cachedDateKeys.push(dk)  // 昨日以前 → キャッシュ候補
      } else {
        globalRealtimePeriods.push(p)  // 今日 → リアルタイム
      }
    }
  } else {
    // week/month/custom_range はすべてリアルタイム
    globalRealtimePeriods.push(...periods)
  }

  const serviceIds = services.map(s => s.id)

  // ── キャッシュ読み取り ─────────────────────────────────────────────────

  let cacheMap = new Map<string, Map<string, Map<string, number | null>>>()

  if (cachedDateKeys.length > 0) {
    cacheMap = await readCache(supabase, projectId, serviceIds, cachedDateKeys)
  }

  // ── サービス別リアルタイム期間の決定 ──────────────────────────────────
  //
  // cachedDateKeys のうち、そのサービスに non-null キャッシュが存在しない日を
  // そのサービス専用のリアルタイム期間として追加する。
  //
  // 理由: aggregate バッチが null でキャッシュした日や、
  //       バッチ失敗でキャッシュが全く存在しない日は、
  //       DB のリアルタイムデータにフォールバックすることで最新値を返す。

  // svcId → そのサービス専用の追加リアルタイム期間 (globalRealtimePeriods との合算で使う)
  const svcExtraPeriods = new Map<string, Period[]>()

  if (isDayUnit && !noCache && cachedDateKeys.length > 0) {
    for (const svc of services) {
      const byRef = cacheMap.get(svc.id)
      const extra: Period[] = []
      for (const dk of cachedDateKeys) {
        // non-null キャッシュが 1件でもあれば「キャッシュ済み」と判断
        const hasNonNullCache = byRef
          ? [...byRef.values()].some(byDate => byDate.has(dk) && byDate.get(dk) !== null)
          : false
        if (!hasNonNullCache) {
          const p = periods.find(pp => pp.dateKey === dk)
          if (p) extra.push(p)
        }
      }
      if (extra.length > 0) {
        svcExtraPeriods.set(svc.id, extra)
      }
    }
  }

  // ── リアルタイム取得（サービス別） ─────────────────────────────────────

  // サービス × リアルタイム period のデータ
  const realtimeMap = new Map<string, Record<string, Record<string, number | null>>>()

  await Promise.all(
    services.map(async svc => {
      const extra = svcExtraPeriods.get(svc.id) ?? []
      // 全サービス共通 + このサービス専用の追加期間
      const svcPeriods = [
        ...globalRealtimePeriods,
        ...extra.filter(p => !globalRealtimePeriods.includes(p)),
      ]
      if (svcPeriods.length === 0) return

      const catalog = getMetricCatalogForProjectAggregate(svc.service_type)
      if (catalog.length === 0) return

      const fieldRefs = catalog.map(c => c.id)
      try {
        const rawData = await fetchMetricsByRefs(supabase, svc.id, fieldRefs, svcPeriods)
        realtimeMap.set(svc.id, rawData)
      } catch (err) {
        console.error(`[unified-summary] realtime fetch failed for service ${svc.id}:`, err)
      }
    }),
  )

  // ── 結果マージ ─────────────────────────────────────────────────────────

  const serviceResults: ServiceResult[] = services.map(svc => {
    const catalog = getMetricCatalogForProjectAggregate(svc.service_type)
    if (catalog.length === 0) {
      return { id: svc.id, name: svc.service_name, serviceType: svc.service_type, metrics: {} }
    }

    const byRefCache = cacheMap.get(svc.id)    // Map<metricRef, Map<dateKey, value>>
    const realtimeData = realtimeMap.get(svc.id) // { metricRef: { periodLabel: value } }
    // このサービスのリアルタイム期間ラベルセット（キャッシュより優先する期間）
    const extra = svcExtraPeriods.get(svc.id) ?? []
    const realtimeLabels = new Set([
      ...globalRealtimePeriods.map(p => p.label),
      ...extra.map(p => p.label),
    ])

    const metrics: ServiceResult['metrics'] = {}

    for (const card of catalog) {
      const values: MetricValues = {}

      for (const p of periods) {
        const dk = periodDateKey(p)  // YYYY-MM-DD or null

        // リアルタイム期間（今日 or このサービスのキャッシュ欠損日）はキャッシュを使わない
        const isRealtimePeriod = realtimeLabels.has(p.label)

        // キャッシュ優先: day 単位 かつ nocache=false かつ リアルタイム対象外の期間
        if (!isRealtimePeriod && dk && !noCache && byRefCache?.has(card.id)) {
          const byDate = byRefCache.get(card.id)!
          if (byDate.has(dk)) {
            // null キャッシュはリアルタイムにフォールバック（stale null 対策）
            // Map.get() は undefined を返す可能性があるので ?? null で正規化
            const cached = byDate.get(dk) ?? null
            if (cached !== null) {
              values[p.label] = cached
              continue
            }
          }
        }

        // リアルタイムデータから取得（キャッシュなし・null キャッシュ・今日・欠損日）
        const raw = realtimeData?.[card.id]?.[p.label]
        values[p.label] = raw !== undefined ? raw : null
      }

      metrics[card.id] = {
        label:    card.label,
        category: card.category,
        values,
      }
    }

    return { id: svc.id, name: svc.service_name, serviceType: svc.service_type, metrics }
  })

  return NextResponse.json({
    success: true,
    data: {
      periods:  periods.map(p => p.label),
      services: serviceResults,
    },
  })
}

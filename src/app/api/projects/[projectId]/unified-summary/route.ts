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
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

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
  //   - 各 Period の dateKey を確認
  //   - JST 今日 は常にリアルタイム取得（バッチ未実行のため）
  //   - それ以外の日はキャッシュ優先
  //
  // week / month / custom_range のとき:
  //   - 集計済みキャッシュがないのでリアルタイム取得

  const today = jstToday()
  const isDayUnit = timeUnit === 'day'

  // キャッシュを使う dateKey の集合（day 単位 かつ nocache=false の場合のみ）
  const cachedDateKeys: string[] = []
  const realtimePeriods: Period[] = []

  if (isDayUnit && !noCache) {
    for (const p of periods) {
      const dk = periodDateKey(p)
      if (dk && dk !== today) {
        cachedDateKeys.push(dk)  // 昨日以前 → キャッシュ候補
      } else {
        realtimePeriods.push(p)  // 今日 → リアルタイム
      }
    }
  } else {
    // week/month/custom_range はすべてリアルタイム
    realtimePeriods.push(...periods)
  }

  const serviceIds = services.map(s => s.id)

  // ── キャッシュ読み取り ─────────────────────────────────────────────────

  let cacheMap = new Map<string, Map<string, Map<string, number | null>>>()

  if (cachedDateKeys.length > 0) {
    cacheMap = await readCache(supabase, projectId, serviceIds, cachedDateKeys)
  }

  // キャッシュに存在しない dateKey（バッチ未実行日）はリアルタイム取得に追加
  const missingDateKeys: string[] = []
  if (cachedDateKeys.length > 0) {
    for (const dk of cachedDateKeys) {
      const anySvcHasCache = serviceIds.some(sid => {
        const byRef = cacheMap.get(sid)
        if (!byRef) return false
        // 1件でもキャッシュエントリがあればOK
        for (const byDate of byRef.values()) {
          if (byDate.has(dk)) return true
        }
        return false
      })
      if (!anySvcHasCache) {
        missingDateKeys.push(dk)
      }
    }
  }

  // missingDateKeys に対応する Period をリアルタイムへ
  for (const p of periods) {
    const dk = periodDateKey(p)
    if (dk && missingDateKeys.includes(dk) && !realtimePeriods.includes(p)) {
      realtimePeriods.push(p)
    }
  }

  // ── リアルタイム取得 ───────────────────────────────────────────────────

  // サービス × リアルタイムperiod のデータ
  const realtimeMap = new Map<string, Record<string, Record<string, number | null>>>()

  if (realtimePeriods.length > 0) {
    await Promise.all(
      services.map(async svc => {
        const catalog = getMetricCatalog(svc.service_type)
        if (catalog.length === 0) return

        const fieldRefs = catalog.map(c => c.id)
        try {
          const rawData = await fetchMetricsByRefs(supabase, svc.id, fieldRefs, realtimePeriods)
          realtimeMap.set(svc.id, rawData)
        } catch (err) {
          console.error(`[unified-summary] realtime fetch failed for service ${svc.id}:`, err)
        }
      }),
    )
  }

  // ── 結果マージ ─────────────────────────────────────────────────────────

  const serviceResults: ServiceResult[] = services.map(svc => {
    const catalog = getMetricCatalog(svc.service_type)
    if (catalog.length === 0) {
      return { id: svc.id, name: svc.service_name, serviceType: svc.service_type, metrics: {} }
    }

    const byRefCache = cacheMap.get(svc.id)   // Map<metricRef, Map<dateKey, value>>
    const realtimeData = realtimeMap.get(svc.id) // { metricRef: { periodLabel: value } }

    const metrics: ServiceResult['metrics'] = {}

    for (const card of catalog) {
      const values: MetricValues = {}

      for (const p of periods) {
        const dk = periodDateKey(p)  // YYYY-MM-DD or null

        // キャッシュから取得できるか判定（day単位 かつ 今日以外 かつ cacheMap にある）
        if (dk && dk !== today && !noCache && byRefCache?.has(card.id)) {
          const byDate = byRefCache.get(card.id)!
          if (byDate.has(dk)) {
            values[p.label] = byDate.get(dk) ?? null
            continue
          }
        }

        // リアルタイムデータから取得
        values[p.label] = realtimeData?.[card.id]?.[p.label] ?? null
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

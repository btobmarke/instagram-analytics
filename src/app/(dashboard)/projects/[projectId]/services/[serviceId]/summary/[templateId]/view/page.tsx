'use client'

import { use, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import type { ServiceDetail, SummaryTemplate, TimeUnit, FormulaNode, MetricCard } from '../../_lib/types'
import { TIME_UNIT_LABELS, OPERATOR_SYMBOLS, formatFormula } from '../../_lib/types'
import { getMetricCatalog } from '../../_lib/catalog'
import { getTemplate } from '../../_lib/store'
import { generateJstDayPeriodLabels, generateCustomRangePeriod } from '@/lib/summary/jst-periods'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SERVICE_THEME: Record<string, { accent: string; bg: string; border: string; badge: string }> = {
  instagram: { accent: 'text-pink-600',   bg: 'bg-pink-50',   border: 'border-pink-200',   badge: 'bg-pink-100 text-pink-700' },
  gbp:       { accent: 'text-teal-600',   bg: 'bg-teal-50',   border: 'border-teal-200',   badge: 'bg-teal-100 text-teal-700' },
  line:      { accent: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200',  badge: 'bg-green-100 text-green-700' },
  lp:        { accent: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
}
const SERVICE_LABEL: Record<string, string> = { instagram: 'Instagram', gbp: 'GBP', line: 'LINE OAM', lp: 'LP' }

const TIME_COL_COUNT = 8

function generateTimeHeaders(
  unit: TimeUnit,
  count: number,
  rangeStart?: string | null,
  rangeEnd?: string | null,
): string[] {
  if (unit === 'custom_range') {
    if (rangeStart && rangeEnd) return [generateCustomRangePeriod(rangeStart, rangeEnd).label]
    return ['（期間未設定）']
  }
  if (unit === 'day') return generateJstDayPeriodLabels(count)
  const headers: string[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    switch (unit) {
      case 'hour':  d.setHours(d.getHours() - i);   headers.push(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`); break
      case 'week': { const s = new Date(d); s.setDate(d.getDate()-i*7); headers.push(`${s.getMonth()+1}/${s.getDate()}週`); break }
      case 'month': d.setMonth(d.getMonth() - i);   headers.push(`${d.getFullYear()}/${d.getMonth()+1}`); break
    }
  }
  return headers
}

/** サマリーAPIが返す生フィールドRefか（custom.* はデータ取得対象外） */
function isSummaryDataFieldRef(ref: string): boolean {
  if (!ref || !ref.includes('.')) return false
  if (ref.startsWith('custom.')) return false
  return true
}

/**
 * フォーミュラを期間ごとに計算
 * + / − は欠損（null）を 0 として足し引き（片方だけデータがある合算を表示するため）
 * × / ÷ はいずれか欠損なら null
 */
function evalFormula(
  formula: FormulaNode,
  rawData: Record<string, Record<string, number | null>>,
  label: string,
): number | null {
  let sawNumeric = false
  const get = (id: string): number | null => {
    const v = rawData[id]?.[label]
    if (v !== null && v !== undefined) sawNumeric = true
    return v ?? null
  }

  const asPlusMinus = (v: number | null) => (v === null ? 0 : v)

  let result: number | null = get(formula.baseOperandId)

  for (const step of formula.steps) {
    const operand = get(step.operandId)
    switch (step.operator) {
      case '+':
        result = asPlusMinus(result) + asPlusMinus(operand)
        break
      case '-':
        result = asPlusMinus(result) - asPlusMinus(operand)
        break
      case '*': {
        if (result === null || operand === null) return null
        result *= operand
        break
      }
      case '/': {
        if (result === null || operand === null) return null
        if (operand === 0) return null
        result /= operand
        break
      }
    }
  }

  if (!sawNumeric) return null
  const rounded = Math.round((result ?? 0) * 100) / 100
  const tm = formula.thresholdMode ?? 'none'
  const tv = formula.thresholdValue
  if (tm === 'gte' && tv != null && rounded < tv) return null
  if (tm === 'lte' && tv != null && rounded > tv) return null
  return rounded
}

/** 数値を読みやすい形式にフォーマット */
function formatCell(value: number | null): string {
  if (value === null) return '—'
  if (Number.isInteger(value)) return value.toLocaleString('ja-JP')
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })
}

// テーブル名を人間が読みやすい形に変換
function tableDisplayName(tableId: string): string {
  const map: Record<string, string> = {
    ig_account_insight_fact: 'Instagram アカウントインサイト',
    ig_media_insight_feed:   'Instagram フィード投稿インサイト',
    ig_media_insight_reels:  'Instagram リール投稿インサイト',
    ig_media_insight_story:  'Instagram ストーリーズインサイト',
    gbp_performance_daily:   'GBP パフォーマンス（日次）',
    gbp_reviews:             'GBP クチコミ',
    line_oam_friends_daily:  'LINE OAM 友だち数（日次）',
    line_oam_friends_attr:   'LINE OAM 友だち属性',
    line_oam_shopcard_status:'LINE OAM ショップカード状況',
    line_oam_shopcard_point: 'LINE OAM ポイント分布',
    line_oam_rewardcard_txns:'LINE OAM リワードカードTXN',
    metric_summaries:        'LP KPI集計',
    lp_sessions:             'LP セッション',
    lp_page_views:           'LP ページビュー',
    lp_event_logs:           'LP イベントログ',
    lp_users:                'LP ユーザー',
  }
  return map[tableId] ?? tableId
}

// ============================================================
// 指標説明モーダル
// ============================================================
function MetricInfoModal({
  card,
  formula,
  allCards,
  onClose,
}: {
  card: MetricCard | undefined
  formula: FormulaNode | undefined
  allCards: MetricCard[]
  onClose: () => void
}) {
  if (!card) return null
  const isCustom = !!formula

  // テーブル名とフィールド名を分解
  const [tablePart, fieldPart] = (card.fieldRef ?? '').split('.')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {isCustom ? (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 flex-shrink-0" />
            )}
            <h3 className="font-bold text-gray-900 text-base">{card.label}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-5 space-y-4">
          {/* 種別バッジ */}
          <div className="flex items-center gap-2">
            {isCustom ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                ✦ カスタム指標
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                標準指標
              </span>
            )}
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
              {card.category}
            </span>
          </div>

          {/* カスタム指標: フォーミュラ表示 */}
          {isCustom && formula && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">計算式</p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 font-mono text-sm text-amber-800 break-all">
                {formatFormula(formula, id => allCards.find(c => c.id === id)?.label ?? id)}
              </div>
              {/* 使用している指標一覧 */}
              <div className="mt-2 space-y-1">
                {[formula.baseOperandId, ...formula.steps.map(s => s.operandId)].map((id, opIdx) => {
                  const src = allCards.find(c => c.id === id)
                  if (!src) return null
                  return (
                    <div key={`${id}#${opIdx}`} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{src.label}</span>
                      <span className="text-gray-300">·</span>
                      <span className="font-mono text-gray-400">{src.fieldRef}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 標準指標: データソース表示 */}
          {!isCustom && tablePart && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">データソース</p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 w-20 flex-shrink-0 pt-0.5">テーブル</span>
                  <div>
                    <p className="text-xs font-medium text-gray-800">{tableDisplayName(tablePart)}</p>
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{tablePart}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-20 flex-shrink-0">フィールド</span>
                  <span className="text-xs font-mono text-gray-700 bg-white border border-gray-200 px-2 py-0.5 rounded">{fieldPart}</span>
                </div>
              </div>
            </div>
          )}

          {/* fieldRef（全指標共通） */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">フィールドRef</p>
            <code className="text-xs font-mono text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg block">
              {card.fieldRef}
            </code>
          </div>
        </div>

        {/* フッター */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SummaryViewPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string; templateId: string }>
}) {
  const { projectId, serviceId, templateId } = use(params)
  const router = useRouter()

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher,
  )
  const service = svcData?.data
  const serviceType = service?.service_type ?? ''
  const theme = SERVICE_THEME[serviceType] ?? {
    accent: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700',
  }

  const [template, setTemplate] = useState<SummaryTemplate | null>(null)

  // 「?」モーダル: 行インデックス（同一指標を複数行にしたとき row.id が重複するため）
  const [infoRowIndex, setInfoRowIndex] = useState<number | null>(null)

  useEffect(() => {
    getTemplate(templateId, serviceId).then(tmpl => {
      if (!tmpl) { router.push(`/projects/${projectId}/services/${serviceId}/summary`); return }
      setTemplate(tmpl)
    })
  }, [templateId, projectId, serviceId, router])

  // ── カスタム指標ライブラリ ─────────────────────────────────────
  interface LibraryMetric { id: string; name: string; formula: FormulaNode }
  const { data: libraryResp } = useSWR<{ success: boolean; data: LibraryMetric[] }>(
    serviceId ? `/api/services/${serviceId}/custom-metrics` : null,
    fetcher,
  )
  const libraryCards: MetricCard[] = useMemo(
    () => (libraryResp?.data ?? []).map(m => ({
      id:       m.id,
      label:    m.name,
      category: 'カスタム指標',
      fieldRef: m.id,
      formula:  m.formula,
    })),
    [libraryResp],
  )

  // フォームの全フィールドRef を収集（カスタム指標のオペランドも含む）
  const allFieldRefs = useMemo(() => {
    if (!template) return []
    const catalog = getMetricCatalog(serviceType)
    // ライブラリ優先、旧 customCards をフォールバック
    const allCards = [...catalog, ...libraryCards, ...(template.customCards ?? [])]
    const refs = new Set<string>()
    const addFormulaRefs = (f: FormulaNode | undefined) => {
      if (!f) return
      if (f.baseOperandId) refs.add(f.baseOperandId)
      for (const step of f.steps) {
        if (step.operandId) refs.add(step.operandId)
      }
    }
    for (const row of template.rows) {
      const card = allCards.find(c => c.id === row.id)
      const effectiveFormula = row.formula ?? card?.formula
      if (effectiveFormula) {
        addFormulaRefs(effectiveFormula)
      } else if (isSummaryDataFieldRef(row.id)) {
        refs.add(row.id)
      }
      if (card?.formula && card.formula !== effectiveFormula) {
        addFormulaRefs(card.formula)
      }
    }
    return [...refs].filter(isSummaryDataFieldRef)
  }, [template, serviceType, libraryCards])

  // 集計データ取得
  const dataUrl = useMemo(() => {
    if (!template || allFieldRefs.length === 0) return null
    if (template.timeUnit === 'custom_range') {
      if (!template.rangeStart || !template.rangeEnd || template.rangeStart > template.rangeEnd) return null
    }
    let u = `/api/services/${serviceId}/summary/data?fields=${encodeURIComponent(allFieldRefs.join(','))}&timeUnit=${template.timeUnit}&count=${TIME_COL_COUNT}`
    if (template.timeUnit === 'custom_range' && template.rangeStart && template.rangeEnd) {
      u += `&rangeStart=${encodeURIComponent(template.rangeStart)}&rangeEnd=${encodeURIComponent(template.rangeEnd)}`
    }
    return u
  }, [template, serviceId, allFieldRefs])

  const { data: rawDataRes, isLoading: dataLoading } = useSWR<{
    success: boolean
    data: Record<string, Record<string, number | null>>
  }>(dataUrl, fetcher)

  const rawData = rawDataRes?.data ?? {}

  const timeHeaders = useMemo(() => {
    if (!template) return [] as string[]
    return generateTimeHeaders(template.timeUnit, TIME_COL_COUNT, template.rangeStart, template.rangeEnd)
  }, [template])

  const axisDescription = useMemo(() => {
    if (!template) return ''
    if (template.timeUnit === 'custom_range' && template.rangeStart && template.rangeEnd) {
      return generateCustomRangePeriod(template.rangeStart, template.rangeEnd).label
    }
    return TIME_UNIT_LABELS[template.timeUnit]
  }, [template])

  if (!template) return <div className="p-8 text-center text-gray-400 text-sm">読み込み中...</div>

  const catalog = getMetricCatalog(serviceType)
  // ライブラリ優先、旧 customCards をフォールバック
  const allCards = [...catalog, ...libraryCards, ...(template.customCards ?? [])]

  // 現在infoが開いている行のデータを取得
  const infoRow =
    infoRowIndex !== null && infoRowIndex >= 0 && infoRowIndex < template.rows.length
      ? template.rows[infoRowIndex]
      : null
  const infoCard = infoRow ? allCards.find(c => c.id === infoRow.id) : null
  const infoFormula: FormulaNode | undefined = infoRow?.formula ?? infoCard?.formula

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href={`/projects/${projectId}`} className="hover:text-purple-600">{service?.project?.project_name ?? 'プロジェクト'}</Link>
        <Chevron />
        <Link href={`/projects/${projectId}/services/${serviceId}/summary`} className="hover:text-purple-600">{service?.service_name ?? '...'} / サマリーテンプレート</Link>
        <Chevron />
        <Link href={`/projects/${projectId}/services/${serviceId}/summary/${templateId}`} className="hover:text-purple-600">{template.name}</Link>
        <Chevron />
        <span className="text-gray-700 font-medium">サマリー</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${theme.badge}`}>
              {SERVICE_LABEL[serviceType] ?? serviceType}
            </span>
            <h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
          </div>
          <p className="text-xs text-gray-500">
            横軸: {axisDescription}
            {' · '}{template.rows.length}項目
            {libraryCards.length > 0 && ` · カスタム指標${libraryCards.length}件`}
            {' · '}最終更新: {new Date(template.updatedAt).toLocaleDateString('ja-JP')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/projects/${projectId}/services/${serviceId}/summary/${templateId}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            テンプレートを編集
          </Link>
        </div>
      </div>

      {/* サマリーテーブル */}
      {template.rows.length === 0 ? (
        <div className={`rounded-2xl border-2 border-dashed ${theme.border} ${theme.bg} p-12 text-center`}>
          <div className="w-12 h-12 rounded-full bg-white/60 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">表示する項目がありません</p>
          <p className="text-xs text-gray-400 mb-4">テンプレートに指標を追加してからサマリーを確認してください</p>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/summary/${templateId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
          >
            テンプレートを編集する
          </Link>
        </div>
      ) : template.timeUnit === 'custom_range' && (!template.rangeStart || !template.rangeEnd || template.rangeStart > template.rangeEnd) ? (
        <div className={`rounded-2xl border ${theme.border} ${theme.bg} p-8 text-center`}>
          <p className="text-sm font-medium text-gray-700 mb-1">集計期間が未設定です</p>
          <p className="text-xs text-gray-500 mb-4">テンプレート編集で「期間指定」の開始日・終了日を保存してください。</p>
          <Link
            href={`/projects/${projectId}/services/${serviceId}/summary/${templateId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
          >
            テンプレートを編集する
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* テーブルヘッダ */}
          <div className={`px-4 py-2 ${theme.bg} border-b ${theme.border} flex items-center justify-between`}>
            <span className="text-xs font-medium text-gray-600">
              横軸: {axisDescription}
            </span>
            <div className="flex items-center gap-3">
              {dataLoading && (
                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  データ取得中...
                </span>
              )}
              <span className="text-[10px] text-gray-400">
                {template.rows.length}項目 × {timeHeaders.length}期間
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-bold text-gray-600 min-w-[220px] z-10 border-r border-gray-100">
                    項目
                  </th>
                  {timeHeaders.map(h => (
                    <th key={h} className="px-3 py-3 text-center text-[11px] font-medium text-gray-500 min-w-[90px] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {template.rows.map((row, rowIdx) => {
                  const srcCard = allCards.find(c => c.id === row.id)
                  const formula: FormulaNode | undefined = row.formula ?? srcCard?.formula
                  const isCustom = !!formula

                  return (
                    <tr
                      key={`row-${rowIdx}-${row.id}`}
                      className={`border-b border-gray-100 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} hover:bg-blue-50/20 transition`}
                    >
                      {/* 行ラベル */}
                      <td className="sticky left-0 bg-inherit px-4 py-3 z-10 border-r border-gray-100">
                        <div className="flex items-center gap-1.5">
                          {isCustom && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="カスタム指標" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-800">{row.label}</div>
                            {formula ? (
                              <div className="text-[9px] text-amber-500 font-mono mt-0.5 truncate">
                                {formatFormula(formula, id => allCards.find(c => c.id === id)?.label ?? id)}
                              </div>
                            ) : srcCard && (
                              <div className="text-[9px] text-gray-400 font-mono mt-0.5">{srcCard.fieldRef}</div>
                            )}
                          </div>
                          {/* ？アイコン */}
                          <button
                            onClick={() => setInfoRowIndex(rowIdx)}
                            className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center text-[10px] font-bold transition ml-1"
                            title="この指標の説明を表示"
                          >
                            ?
                          </button>
                        </div>
                      </td>

                      {/* データセル */}
                      {timeHeaders.map(h => {
                        let value: number | null = null
                        if (dataLoading) {
                          return (
                            <td key={h} className="px-3 py-3 text-center">
                              <div className="h-3 bg-gray-100 rounded animate-pulse mx-auto w-10" />
                            </td>
                          )
                        }
                        if (formula) {
                          value = evalFormula(formula, rawData, h)
                        } else {
                          value = rawData[row.id]?.[h] ?? null
                        }
                        return (
                          <td
                            key={h}
                            className={`px-3 py-3 text-center text-xs font-mono ${
                              value !== null ? 'text-gray-800' : 'text-gray-300'
                            }`}
                          >
                            {formatCell(value)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* フッタ */}
          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                カスタム指標
              </span>
              <span>— はデータなし</span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center text-[9px] font-bold">?</span>
                指標の説明
              </span>
            </div>
            <span className="text-[10px] text-gray-400">
              テンプレートID: {template.id}
            </span>
          </div>
        </div>
      )}

      {/* 指標説明モーダル */}
      {infoRowIndex !== null && infoCard && (
        <MetricInfoModal
          card={infoCard}
          formula={infoFormula}
          allCards={allCards}
          onClose={() => setInfoRowIndex(null)}
        />
      )}
    </div>
  )
}

function Chevron() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
}

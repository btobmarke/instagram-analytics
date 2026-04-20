'use client'

import { useMemo, useState } from 'react'
import type { MetricCard } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import { formatFormula } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types'
import type { InstagramServiceKpiCardType } from '@/types'

function MetricTooltip({ description, isCustom }: { description?: string; isCustom: boolean }) {
  const [open, setOpen] = useState(false)
  if (!description) return null
  return (
    <div className="relative flex-shrink-0" style={{ zIndex: open ? 50 : 'auto' }}>
      {/* SelectableCard が <button> のため、内側は <button> にできない（hydration エラー回避） */}
      <span
        tabIndex={0}
        aria-label="指標の説明（ホバーで表示）"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLElement).blur()
        }}
        className={`inline-flex w-3.5 h-3.5 rounded-full items-center justify-center text-[8px] font-bold leading-none transition cursor-default outline-none focus-visible:ring-2 focus-visible:ring-purple-400
          ${isCustom ? 'bg-amber-200 text-amber-600 hover:bg-amber-300' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}
      >
        ?
      </span>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 pointer-events-none">
          <div className="bg-gray-900 text-white text-[10px] leading-relaxed rounded-lg px-2.5 py-2 shadow-xl">
            {description}
          </div>
          <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}

function SelectableCard({
  card,
  selected,
  onSelect,
}: {
  card: MetricCard
  selected: boolean
  onSelect: () => void
}) {
  const isCustom = !!card.formula
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative px-3 py-2 rounded-lg border text-xs font-medium select-none text-left transition
        ${selected
          ? isCustom
            ? 'ring-2 ring-amber-400 border-amber-300 bg-amber-50 text-amber-900'
            : 'ring-2 ring-purple-400 border-purple-300 bg-white text-gray-900'
          : isCustom
            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-400 hover:shadow-sm'
            : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:shadow-sm'
        }`}
    >
      <span className={`text-[10px] block mb-0.5 ${isCustom ? 'text-amber-500' : 'text-gray-400'}`}>{card.category}</span>
      <div className="flex items-start gap-1">
        <span className="flex-1">{card.label}</span>
        <MetricTooltip description={card.description} isCustom={isCustom} />
      </div>
      <span className={`text-[9px] block mt-0.5 font-mono ${isCustom ? 'text-amber-400' : 'text-gray-300'}`}>
        {card.formula ? formatFormula(card.formula, (id) => id, 'id') : card.fieldRef}
      </span>
    </button>
  )
}

export function KpiCardField({
  cardType,
  cardRef,
  catalog,
  customCards,
  onChangeType,
  onSelectCard,
}: {
  cardType: InstagramServiceKpiCardType
  cardRef: string
  catalog: MetricCard[]
  customCards: MetricCard[]
  onChangeType: (t: InstagramServiceKpiCardType) => void
  onSelectCard: (id: string) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredMetric = useMemo(() => {
    if (!searchQuery.trim()) return catalog
    const q = searchQuery.trim().toLowerCase()
    return catalog.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.fieldRef.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    )
  }, [catalog, searchQuery])

  const filteredCustom = useMemo(() => {
    if (!searchQuery.trim()) return customCards
    const q = searchQuery.trim().toLowerCase()
    return customCards.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.fieldRef.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    )
  }, [customCards, searchQuery])

  const groupedMetric = useMemo(() => {
    const map: Record<string, MetricCard[]> = {}
    for (const c of filteredMetric) {
      ;(map[c.category] ??= []).push(c)
    }
    return map
  }, [filteredMetric])

  return (
    <div className="space-y-2">
      <span className="text-xs text-gray-600">紐づくカード</span>
      <div className="flex gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => onChangeType('metric_card')}
          className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition ${
            cardType === 'metric_card'
              ? 'bg-white text-gray-800 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
          }`}
        >
          指標値カード
        </button>
        <button
          type="button"
          onClick={() => onChangeType('custom_card')}
          className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition ${
            cardType === 'custom_card'
              ? 'bg-amber-100 text-amber-800 shadow-sm border border-amber-200'
              : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
          }`}
        >
          カスタムカード
        </button>
      </div>

      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="フィールドを検索..."
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
      </div>

      <div className="max-h-[220px] overflow-y-auto rounded-lg border border-gray-200/80 bg-white/80 p-2 space-y-3">
        {cardType === 'metric_card' ? (
          Object.keys(groupedMetric).length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">一致する指標がありません</p>
          ) : (
            Object.entries(groupedMetric).map(([cat, cards]) => (
              <div key={cat}>
                <div className="text-[10px] font-semibold text-gray-500 mb-1.5 px-0.5">{cat}</div>
                <div className="flex flex-wrap gap-1.5">
                  {cards.map((c) => (
                    <SelectableCard
                      key={c.id}
                      card={c}
                      selected={cardRef === c.id}
                      onSelect={() => onSelectCard(c.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          )
        ) : customCards.length === 0 ? (
          <p className="text-xs text-gray-400 py-3 text-center">
            カスタム指標がまだありません。サマリーテンプレート編集から作成できます。
          </p>
        ) : filteredCustom.length === 0 ? (
          <p className="text-xs text-gray-400 py-3 text-center">一致するカスタム指標がありません</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 py-1">
            {filteredCustom.map((c) => (
              <SelectableCard
                key={c.id}
                card={c}
                selected={cardRef === c.id}
                onSelect={() => onSelectCard(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

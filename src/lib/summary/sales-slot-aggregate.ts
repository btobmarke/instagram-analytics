/**
 * 売上ダッシュボード・sales_rollup 集計用:
 * 同一営業日に時間帯スロット（11:00-12:00 形式）がある場合、
 * 単独登録で作られた slot_label「all」は時間帯合計と同じ金額のため二重計上になる → 除外する。
 */
/** 時間帯別登録 UI の slot_label（例: 11:00-12:00） */
const HOURLY_RANGE_LABEL = /^\d{2}:\d{2}-\d{2}:\d{2}$/
/** 時間帯別まとめ登録の slot_label（例: 時間帯:10:00-11:00） */
const HOURLY_PREFIX_LABEL = /^時間帯:\d{2}:\d{2}-\d{2}:\d{2}$/

export function slotLabelLooksHourly(slotLabel: string | null | undefined): boolean {
  const s = String(slotLabel ?? '').trim()
  return HOURLY_RANGE_LABEL.test(s) || HOURLY_PREFIX_LABEL.test(s)
}

export function isAllSlotDuplicateWithHourly(
  slotLabel: string | null | undefined,
  peerSlotLabels: Iterable<string>,
): boolean {
  if (String(slotLabel ?? '').trim().toLowerCase() !== 'all') return false
  for (const p of peerSlotLabels) {
    if (slotLabelLooksHourly(p)) return true
  }
  return false
}

/** 税込合計などに使う子行一覧（二重計上の all 行を除いた配列） */
export function salesHourlySlotsForRevenueSum<T extends { slot_label: string }>(slots: T[]): T[] {
  const labels = slots.map(s => String(s.slot_label ?? '').trim())
  const hasHourly = labels.some(slotLabelLooksHourly)
  if (!hasHourly) return slots
  return slots.filter(s => String(s.slot_label ?? '').trim().toLowerCase() !== 'all')
}

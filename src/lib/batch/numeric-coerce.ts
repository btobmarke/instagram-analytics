/**
 * バッチで外部データを DB の数値列に載せるときの共通正規化。
 * 取得失敗時は呼び出し側で upsert しない。成功経路では欠損・空欄・非数を 0 に寄せる用途。
 */

/** 有限数として解釈できる場合のみ返す */
export function finiteNumberFromUnknown(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

export function finiteNumberOrZero(v: unknown): number {
  return finiteNumberFromUnknown(v) ?? 0
}

/**
 * CSV セル等: `null` / `undefined` / 空文字 / 空白のみは 0。カンマ区切り数値を許容。
 */
export function csvCellNumberOrZero(cell: unknown): number {
  if (cell == null) return 0
  const s = String(cell).replace(/,/g, '').trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

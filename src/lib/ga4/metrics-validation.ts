/**
 * GA4 Data API の runReport 向けメトリクス配列の検証（重複・件数上限）
 * 同一リクエスト内で keyEvents と conversions を併用すると API が duplicate conversions を返すため、名前の重複だけでなく禁止ペアもチェックする。
 */

const GA4_MAX_METRICS_PER_REQUEST = 10

/** API 上は別名でも同一指標として拒否されるペア */
const FORBIDDEN_METRIC_PAIRS: ReadonlyArray<[string, string]> = [
  ['conversions', 'keyEvents'],
  ['keyEvents', 'conversions'],
]

export function validateRunReportMetrics(
  metrics: readonly { name: string }[],
  context: string
): void {
  const names = metrics.map((m) => m.name.trim())
  if (names.length > GA4_MAX_METRICS_PER_REQUEST) {
    throw new Error(
      `${context}: メトリクスが ${GA4_MAX_METRICS_PER_REQUEST} 個を超えています（${names.length} 個）`
    )
  }
  const seen = new Set<string>()
  for (const n of names) {
    if (seen.has(n)) {
      throw new Error(`${context}: メトリクス "${n}" が重複しています`)
    }
    seen.add(n)
  }
  const set = new Set(names)
  for (const [a, b] of FORBIDDEN_METRIC_PAIRS) {
    if (set.has(a) && set.has(b)) {
      throw new Error(`${context}: メトリクス "${a}" と "${b}" は同一リクエストに併用できません`)
    }
  }
}

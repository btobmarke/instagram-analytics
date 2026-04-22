/**
 * Instagram Graph API v22+ ではストーリーの `taps_forward` / `taps_back` / `exits` を
 * `GET /{media-id}/insights` の複数 metric クエリに含められない。
 * 代わりに `navigation` + `story_navigation_action_type` breakdown の次元値が使われる。
 * 既存 UI（列表示・マージ）との互換のため、breakdown の action（小文字化済み）を従来コードへ対応付ける。
 */
export function legacyStoryMetricCodeFromNavigationDimension(dim: string): string | null {
  const d = dim.toLowerCase()
  if (d === 'tap_forward') return 'taps_forward'
  if (d === 'tap_back') return 'taps_back'
  if (d === 'tap_exit') return 'exits'
  return null
}

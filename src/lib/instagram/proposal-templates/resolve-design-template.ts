import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'
import { renderCustomSlideHtml } from '@/lib/instagram/proposal-html/render-custom-template'

export type ResolvedSlideRow = {
  wireHtml: string
  partHtmls: string[]
}

/** デザイン定義の各行（ワイヤー＋パーツ HTML）をデッキの各スライドに割り当てる（不足分は最後の行を繰り返す） */
export function resolveDeckToCustomHtml(
  deck: ProposalDeckContentParsed,
  rows: ResolvedSlideRow[],
): string[] {
  if (rows.length === 0) return []
  return deck.slides.map((slide, i) => {
    const row = rows[Math.min(i, rows.length - 1)]!
    return renderCustomSlideHtml(slide, row.wireHtml, row.partHtmls)
  })
}

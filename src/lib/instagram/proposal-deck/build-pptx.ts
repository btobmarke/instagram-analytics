/**
 * 構造化デッキ JSON → PPTX（pptxgenjs）。サーバ（Node）で実行。
 */
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'

export async function buildProposalDeckPptxBuffer(content: ProposalDeckContentParsed): Promise<ArrayBuffer> {
  const mod = await import('pptxgenjs')
  const PptxGenJS = mod.default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'Instagram Analytics'
  pptx.title = content.documentTitle

  for (const slide of content.slides) {
    const s = pptx.addSlide()

    if (slide.pageKey === 'cover') {
      s.addText(slide.slots.title, {
        x: 0.5,
        y: 2,
        w: 9,
        h: 1.2,
        fontSize: 28,
        bold: true,
        color: '363636',
        align: 'center',
        valign: 'middle',
      })
      s.addText(slide.slots.subtitle, {
        x: 0.8,
        y: 3.5,
        w: 8.4,
        h: 2,
        fontSize: 14,
        color: '666666',
        align: 'center',
        valign: 'top',
      })
      continue
    }

    if (slide.pageKey === 'kpi') {
      s.addText(slide.slots.title, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 22, bold: true, color: '363636' })
      const rows: string[][] = [['指標', '値'], ...slide.slots.metric_rows.map((r) => [r.label, r.value])]
      s.addTable(rows, {
        x: 0.6,
        y: 1.2,
        w: 8.8,
        colW: [4.4, 4.4],
        border: { type: 'solid', color: 'CCCCCC', pt: 1 },
        fontSize: 12,
      })
      continue
    }

    if (slide.pageKey === 'section') {
      s.addText(slide.slots.title, { x: 0.5, y: 0.4, w: 9, h: 0.55, fontSize: 20, bold: true, color: '363636' })
      s.addText(slide.slots.body, {
        x: 0.5,
        y: 1.05,
        w: 9,
        h: 2.2,
        fontSize: 12,
        color: '333333',
        valign: 'top',
      })
      const bulletText = slide.slots.bullets.map((b) => `• ${b}`).join('\n')
      if (bulletText.trim()) {
        s.addText(bulletText, {
          x: 0.5,
          y: 3.4,
          w: 9,
          h: 2.2,
          fontSize: 11,
          color: '444444',
          valign: 'top',
        })
      }
    }
  }

  const out = await pptx.write({ outputType: 'arraybuffer' })
  return out as ArrayBuffer
}

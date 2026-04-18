import type { ProposalDeckSlideParsed } from '@/lib/instagram/proposal-deck/schema'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function metricRowsTable(rows: { label: string; value: string }[]): string {
  const body = rows
    .map(
      (r, i) =>
        `<tr class="${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}">` +
        `<td class="py-2 px-3 border-b border-gray-100 text-gray-800">${escapeHtml(r.label)}</td>` +
        `<td class="py-2 px-3 border-b border-gray-100 text-right font-mono text-gray-900">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('')
  return (
    `<table class="w-full text-sm border-collapse">` +
    `<thead><tr class="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">` +
    `<th class="text-left py-2 px-3 font-medium rounded-tl-lg">指標</th>` +
    `<th class="text-right py-2 px-3 font-medium rounded-tr-lg">値</th></tr></thead>` +
    `<tbody>${body}</tbody></table>`
  )
}

function bulletsHtml(bullets: string[]): string {
  if (bullets.length === 0) return ''
  const items = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')
  return `<ul class="list-disc pl-5 space-y-1 text-sm text-gray-800">${items}</ul>`
}

/**
 * ワイヤー HTML に {{PARTS}}、各パーツにプレースホルダを埋め、スライド種別に応じた値を差し込む。
 * プレースホルダ: {{title}} {{subtitle}} {{body}} {{bullets}} {{metric_rows}}
 */
export function buildSlotMap(slide: ProposalDeckSlideParsed): Record<string, string> {
  if (slide.pageKey === 'cover') {
    return {
      title: escapeHtml(slide.slots.title),
      subtitle: escapeHtml(slide.slots.subtitle).replace(/\n/g, '<br/>'),
    }
  }
  if (slide.pageKey === 'kpi') {
    return {
      title: escapeHtml(slide.slots.title),
      metric_rows: metricRowsTable(slide.slots.metric_rows),
    }
  }
  return {
    title: escapeHtml(slide.slots.title),
    body: escapeHtml(slide.slots.body).replace(/\n/g, '<br/>'),
    bullets: bulletsHtml(slide.slots.bullets),
  }
}

function applySlotPlaceholders(html: string, slots: Record<string, string>): string {
  let out = html
  for (const [key, value] of Object.entries(slots)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

export function renderCustomSlideHtml(
  slide: ProposalDeckSlideParsed,
  wireHtml: string,
  partHtmls: string[],
): string {
  const slots = buildSlotMap(slide)
  const mergedParts = partHtmls.map((p) => applySlotPlaceholders(p, slots)).join('\n')
  let merged = wireHtml.includes('{{PARTS}}')
    ? wireHtml.split('{{PARTS}}').join(mergedParts)
    : `${wireHtml}\n${mergedParts}`
  merged = applySlotPlaceholders(merged, slots)
  return merged
}

import type { IgMedia } from '@/types'

function carouselSlideCount(childrenJson: unknown): number {
  if (!childrenJson || !Array.isArray(childrenJson)) return 0
  return childrenJson.length
}

/** 投稿メタの人間向けブロック（AI や画面用） */
export function formatPostMetaContextBlock(post: IgMedia): string {
  const posted = new Date(post.posted_at)
  const wd = ['日', '月', '火', '水', '木', '金', '土'][posted.getDay()]
  const hour = posted.getHours()
  const band =
    hour < 6 ? '深夜' : hour < 12 ? '午前' : hour < 18 ? '午後' : '夜間'
  const cap = post.caption ?? ''
  const slides = carouselSlideCount(post.children_json)
  const lines = [
    `投稿日時: ${posted.toLocaleString('ja-JP')}（${wd}曜・${band}帯）`,
    `メディア種別: ${post.media_product_type ?? post.media_type}`,
    `キャプション文字数: ${cap.length} 字`,
    slides > 0 ? `カルーセル枚数: ${slides}` : null,
    post.shortcode ? `shortcode: ${post.shortcode}` : null,
    post.permalink ? `permalink: あり` : null,
  ].filter(Boolean) as string[]
  return lines.join('\n')
}

export function postMetaRows(post: IgMedia): { label: string; value: string }[] {
  const block = formatPostMetaContextBlock(post)
  return block.split('\n').map(line => {
    const i = line.indexOf(':')
    if (i === -1) return { label: line, value: '' }
    return { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
  })
}

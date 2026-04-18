'use client'

import type { MutableRefObject, Ref } from 'react'
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'

const SLIDE_W = 960
const SLIDE_H = 540

export function CustomProposalHtmlSlides({
  deck,
  slideHtml,
  slideRefs,
}: {
  deck: ProposalDeckContentParsed
  /** 各スライドのレンダリング済み HTML（長さは deck.slides と一致） */
  slideHtml: string[]
  slideRefs?: MutableRefObject<(HTMLDivElement | null)[]>
}) {
  return (
    <div className="space-y-8">
      {deck.slides.map((_, idx) => {
        const setRef = (el: HTMLDivElement | null) => {
          if (slideRefs?.current) slideRefs.current[idx] = el
        }
        const html = slideHtml[idx] ?? '<p class="p-4 text-red-600">スライドの生成に失敗しました</p>'
        return (
          <div key={idx} className="space-y-1">
            <p className="text-[10px] text-teal-700 font-medium">スライド {idx + 1} · 登録テンプレート</p>
            <div
              ref={setRef as Ref<HTMLDivElement> | undefined}
              data-proposal-slide="1"
              className="relative overflow-hidden rounded-lg shadow-lg border border-gray-200 bg-white mx-auto proposal-html-scope"
              style={{ width: SLIDE_W, height: SLIDE_H }}
            >
              <div className="absolute inset-0 overflow-auto" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

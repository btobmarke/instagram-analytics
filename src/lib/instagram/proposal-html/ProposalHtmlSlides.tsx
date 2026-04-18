'use client'

import type { MutableRefObject, Ref } from 'react'
import type { ProposalDeckContentParsed } from '@/lib/instagram/proposal-deck/schema'
import type { ProposalHtmlTemplateDef } from '@/lib/instagram/proposal-html/templates'

/** 16:9 スライド枠（px ベース・プレビュー用） */
const SLIDE_W = 960
const SLIDE_H = 540

export function ProposalHtmlSlides({
  deck,
  template,
  slideRefs,
}: {
  deck: ProposalDeckContentParsed
  template: ProposalHtmlTemplateDef
  /** 各スライドのルート要素に付与（PPTX 画像化用） */
  slideRefs?: MutableRefObject<(HTMLDivElement | null)[]>
}) {
  return (
    <div className="space-y-8">
      {deck.slides.map((slide, idx) => {
        const setRef = (el: HTMLDivElement | null) => {
          if (slideRefs?.current) slideRefs.current[idx] = el
        }
        const common = {
          slideRefCallback: setRef,
          width: SLIDE_W,
          height: SLIDE_H,
          index: idx,
        }
        if (slide.pageKey === 'cover') {
          return (
            <CoverSlide
              key={`cover-${idx}`}
              {...common}
              title={slide.slots.title}
              subtitle={slide.slots.subtitle}
            />
          )
        }
        if (slide.pageKey === 'kpi') {
          return (
            <KpiSlide
              key={`kpi-${idx}`}
              {...common}
              wire={template.rules.kpi.wireId}
              title={slide.slots.title}
              rows={slide.slots.metric_rows}
            />
          )
        }
        return (
          <SectionSlide
            key={`sec-${slide.sectionId}-${idx}`}
            {...common}
            wire={template.rules.section.wireId}
            title={slide.slots.title}
            body={slide.slots.body}
            bullets={slide.slots.bullets}
          />
        )
      })}
    </div>
  )
}

function SlideChrome({
  children,
  width,
  height,
  index,
  wireLabel,
  slideRefCallback,
}: {
  children: React.ReactNode
  width: number
  height: number
  index: number
  wireLabel: string
  slideRefCallback?: (el: HTMLDivElement | null) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-teal-700 font-medium">
        スライド {index + 1} · ワイヤー {wireLabel}
      </p>
      <div
        ref={slideRefCallback as Ref<HTMLDivElement> | undefined}
        data-proposal-slide="1"
        className="relative overflow-hidden rounded-lg shadow-lg border border-gray-200 bg-white mx-auto"
        style={{ width, height }}
      >
        {children}
      </div>
    </div>
  )
}

function CoverSlide({
  title,
  subtitle,
  width,
  height,
  index,
  slideRefCallback,
}: {
  title: string
  subtitle: string
  width: number
  height: number
  index: number
  slideRefCallback?: (el: HTMLDivElement | null) => void
}) {
  return (
    <SlideChrome slideRefCallback={slideRefCallback} width={width} height={height} index={index} wireLabel="A（中央）">
      <div
        className="absolute inset-0 flex flex-col items-center justify-center px-12"
        style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #e0e7ff 45%, #fce7f3 100%)',
        }}
      >
        <h1 className="text-3xl font-bold text-gray-900 text-center leading-tight">{title}</h1>
        <p className="mt-6 text-sm text-gray-600 text-center whitespace-pre-wrap leading-relaxed max-w-2xl">
          {subtitle}
        </p>
      </div>
    </SlideChrome>
  )
}

function KpiSlide({
  wire,
  title,
  rows,
  width,
  height,
  index,
  slideRefCallback,
}: {
  wire: string
  title: string
  rows: { label: string; value: string }[]
  width: number
  height: number
  index: number
  slideRefCallback?: (el: HTMLDivElement | null) => void
}) {
  const isSplit = wire === 'C_kpi_split'

  const table = (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <th className="text-left py-2 px-3 font-medium rounded-tl-lg">指標</th>
          <th className="text-right py-2 px-3 font-medium rounded-tr-lg">値</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
            <td className="py-2 px-3 border-b border-gray-100 text-gray-800">{r.label}</td>
            <td className="py-2 px-3 border-b border-gray-100 text-right font-mono text-gray-900">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (isSplit) {
    return (
      <SlideChrome slideRefCallback={slideRefCallback} width={width} height={height} index={index} wireLabel="C（左右分割）">
        <div className="absolute inset-0 flex">
          <div className="w-[38%] bg-slate-900 text-white flex items-center px-6">
            <h2 className="text-xl font-bold leading-snug">{title}</h2>
          </div>
          <div className="flex-1 p-6 flex items-center">{table}</div>
        </div>
      </SlideChrome>
    )
  }

  return (
    <SlideChrome slideRefCallback={slideRefCallback} width={width} height={height} index={index} wireLabel="B（上見出し＋表）">
      <div className="absolute inset-0 p-8 flex flex-col">
        <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-indigo-200 pb-2">{title}</h2>
        <div className="flex-1 min-h-0">{table}</div>
      </div>
    </SlideChrome>
  )
}

function SectionSlide({
  wire,
  title,
  body,
  bullets,
  width,
  height,
  index,
  slideRefCallback,
}: {
  wire: string
  title: string
  body: string
  bullets: string[]
  width: number
  height: number
  index: number
  slideRefCallback?: (el: HTMLDivElement | null) => void
}) {
  const magazine = wire === 'G_section_magazine'

  if (magazine) {
    return (
      <SlideChrome slideRefCallback={slideRefCallback} width={width} height={height} index={index} wireLabel="G（帯＋本文）">
        <div className="absolute inset-0 flex flex-col">
          <div className="bg-gradient-to-r from-pink-500 to-rose-500 text-white px-8 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
          </div>
          <div className="flex-1 p-8 overflow-auto">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{body}</p>
            <ul className="mt-4 space-y-1.5 text-sm text-gray-800">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-pink-500 font-bold">▸</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SlideChrome>
    )
  }

  return (
    <SlideChrome slideRefCallback={slideRefCallback} width={width} height={height} index={index} wireLabel="F（標準）">
      <div className="absolute inset-0 p-8 flex flex-col">
        <h2 className="text-xl font-bold text-gray-900 mb-3">{title}</h2>
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed flex-shrink-0">{body}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-gray-800 list-disc pl-5 flex-1 overflow-auto">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>
    </SlideChrome>
  )
}

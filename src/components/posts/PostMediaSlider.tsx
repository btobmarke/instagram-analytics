'use client'

import { useState } from 'react'

interface SlideItem {
  mediaUrl?: string | null
  thumbnailUrl?: string | null
}

interface PostMediaSliderProps {
  /** メイン画像 / 動画サムネイル */
  mediaUrl?: string | null
  thumbnailUrl?: string | null
  /** カルーセル子要素（children_json） */
  children?: Array<SlideItem> | null
  /** アスペクト比クラス (デフォルト: aspect-square) */
  aspectClass?: string
  /** 画像クリック時のコールバック */
  onImageClick?: (index: number) => void
}

/**
 * 投稿メディアスライダー
 * - カルーセル投稿: 左右矢印ボタン + ドットインジケーターで複数画像を切り替え
 * - 通常投稿: 単一画像表示
 */
export function PostMediaSlider({
  mediaUrl,
  thumbnailUrl,
  children,
  aspectClass = 'aspect-square',
  onImageClick,
}: PostMediaSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  // スライド配列を構築
  // children が 2 枚以上あればカルーセルとして扱う
  const slides: SlideItem[] =
    children && children.length > 1
      ? children
      : [{ mediaUrl, thumbnailUrl }]

  const isCarousel = slides.length > 1
  const total = slides.length
  const current = slides[currentIndex]
  const imageSrc = current.thumbnailUrl ?? current.mediaUrl ?? null

  const prev = () => setCurrentIndex(i => (i - 1 + total) % total)
  const next = () => setCurrentIndex(i => (i + 1) % total)

  return (
    <div className={`relative ${aspectClass} bg-gray-100 overflow-hidden rounded-xl`}>
      {/* 画像 */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`スライド ${currentIndex + 1} / ${total}`}
          className="w-full h-full object-cover"
          onClick={() => onImageClick?.(currentIndex)}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg
            className="w-12 h-12 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}

      {/* カルーセルUI */}
      {isCarousel && (
        <>
          {/* 左矢印 */}
          <button
            onClick={(e) => { e.stopPropagation(); prev() }}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition backdrop-blur-sm"
            aria-label="前の画像"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* 右矢印 */}
          <button
            onClick={(e) => { e.stopPropagation(); next() }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition backdrop-blur-sm"
            aria-label="次の画像"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* インジケーター（ドット） */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setCurrentIndex(i) }}
                className={`rounded-full transition-all ${
                  i === currentIndex
                    ? 'w-4 h-1.5 bg-white'
                    : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/80'
                }`}
                aria-label={`${i + 1}枚目へ`}
              />
            ))}
          </div>

          {/* 枚数カウント（右上） */}
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/40 text-white text-[11px] font-medium backdrop-blur-sm">
            {currentIndex + 1} / {total}
          </div>
        </>
      )}
    </div>
  )
}

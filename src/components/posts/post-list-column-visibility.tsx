'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PostListMode } from '@/lib/instagram/post-display-mode'

/** 一覧テーブル内の指標ブロックの表示順（左固定のチェック・投稿の右から） */
export const DASHBOARD_POST_LIST_COLUMNS = [
  { id: 'type', label: '種別' },
  { id: 'views', label: '表示' },
  { id: 'homeRate', label: 'ホーム率' },
  { id: 'reach', label: 'リーチ' },
  { id: 'likes', label: 'いいね' },
  { id: 'saved', label: '保存' },
  { id: 'shares', label: 'シェア' },
  { id: 'shareRate', label: 'シェア率' },
  { id: 'egRate', label: 'EG率' },
  { id: 'replies', label: '返信' },
  { id: 'exits', label: '離脱' },
  { id: 'taps_forward', label: '次へ' },
  { id: 'taps_back', label: '戻る' },
  { id: 'postedAt', label: '投稿日' },
  { id: 'manual', label: '手入力' },
  { id: 'detail', label: '詳細' },
] as const

/** サービス詳細 Instagram 投稿一覧: フィード・リール（ストーリー専用指標は含めない） */
export const SERVICE_INSTAGRAM_FEED_POST_LIST_COLUMNS = [
  { id: 'type', label: '種別' },
  { id: 'views', label: '表示' },
  { id: 'viewsFollowerPct', label: 'ビュー·フォロワー率' },
  { id: 'viewsNonFollowerPct', label: 'ビュー·フォロワー外率' },
  { id: 'viewsFollowerCount', label: 'フォロワービュー' },
  { id: 'viewsNonFollowerCount', label: 'フォロワー外ビュー' },
  { id: 'homeRate', label: 'ホーム率' },
  { id: 'reach', label: 'リーチ' },
  { id: 'likes', label: 'いいね' },
  { id: 'saved', label: '保存' },
  { id: 'shares', label: 'シェア' },
  { id: 'shareRate', label: 'シェア率' },
  { id: 'egRate', label: 'EG率' },
  { id: 'postedAt', label: '投稿日' },
  { id: 'detail', label: '詳細' },
] as const

/** サービス詳細 Instagram 投稿一覧: ストーリー（フィード専用の種別・EG 等は含めない） */
export const SERVICE_INSTAGRAM_STORY_POST_LIST_COLUMNS = [
  { id: 'views', label: '表示' },
  { id: 'reach', label: 'リーチ' },
  { id: 'replies', label: '返信' },
  { id: 'exits', label: '離脱' },
  { id: 'taps_forward', label: '次へ' },
  { id: 'taps_back', label: '戻る' },
  { id: 'postedAt', label: '投稿日' },
  { id: 'detail', label: '詳細' },
] as const

export function serviceInstagramPostListColumns(
  mode: PostListMode
): readonly { id: string; label: string }[] {
  return mode === 'story' ? SERVICE_INSTAGRAM_STORY_POST_LIST_COLUMNS : SERVICE_INSTAGRAM_FEED_POST_LIST_COLUMNS
}

/** テーブル行・列トグル用のチェックボックス見た目 */
export const postListFancyCheckboxClass =
  'size-4 shrink-0 cursor-pointer rounded-md border-2 border-gray-300 bg-white accent-purple-600 transition-colors hover:border-purple-400 hover:bg-purple-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40'

/** 列トグル用（やや小さめ） */
export const postListFancyCheckboxSmClass =
  'size-[15px] shrink-0 cursor-pointer rounded-[5px] border-2 border-gray-300 bg-white accent-purple-600 transition-colors hover:border-purple-400 hover:bg-purple-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white'

export type DashboardPostListColumnId = (typeof DASHBOARD_POST_LIST_COLUMNS)[number]['id']
export type ServiceInstagramFeedPostListColumnId =
  (typeof SERVICE_INSTAGRAM_FEED_POST_LIST_COLUMNS)[number]['id']
export type ServiceInstagramStoryPostListColumnId =
  (typeof SERVICE_INSTAGRAM_STORY_POST_LIST_COLUMNS)[number]['id']

/** 初期表示: シェア率・ビュー内訳列はオフ、その他はオン */
export function defaultPostListColumnVisibility(cols: readonly { id: string }[]): Record<string, boolean> {
  const offByDefault = new Set([
    'shareRate',
    'viewsFollowerPct',
    'viewsNonFollowerPct',
    'viewsFollowerCount',
    'viewsNonFollowerCount',
  ])
  const m: Record<string, boolean> = {}
  for (const c of cols) {
    m[c.id] = !offByDefault.has(c.id)
  }
  return m
}

function loadMerged(storageKey: string, cols: readonly { id: string }[]): Record<string, boolean> {
  const base = defaultPostListColumnVisibility(cols)
  if (typeof window === 'undefined') return base
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Record<string, boolean>
    const merged = { ...base }
    for (const c of cols) {
      if (Object.prototype.hasOwnProperty.call(parsed, c.id)) {
        merged[c.id] = parsed[c.id]
      }
    }
    return merged
  } catch {
    return base
  }
}

/** 現在の列セットに含まれる列だけ表示。`visible` にキーが無いときは列の既定（オフ列は false） */
export function isColumnVisible(
  visible: Record<string, boolean>,
  columns: readonly { id: string }[],
  id: string
): boolean {
  if (!columns.some(c => c.id === id)) return false
  if (Object.prototype.hasOwnProperty.call(visible, id)) {
    return visible[id] !== false
  }
  return defaultPostListColumnVisibility(columns)[id] !== false
}

export function usePostListColumnVisibility(storageKey: string, columns: readonly { id: string; label: string }[]) {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => defaultPostListColumnVisibility(columns))
  /** 親が毎レンダー `filter` した新配列を渡すと参照だけ変わり無限ループするため、列 ID 列で依存する */
  const columnsKey = columns.map(c => c.id).join('|')

  useEffect(() => {
    setVisible(loadMerged(storageKey, columns))
  }, [storageKey, columnsKey])

  const toggle = useCallback((id: string, checked: boolean) => {
    setVisible(prev => {
      const next = { ...prev, [id]: checked }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [storageKey])

  const isOn = useCallback(
    (id: string) => isColumnVisible(visible, columns, id),
    [visible, columns]
  )

  return { visible, isOn, toggle }
}

export function PostListColumnToggles({
  columns,
  visible,
  onToggle,
}: {
  columns: readonly { id: string; label: string }[]
  visible: Record<string, boolean>
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold text-gray-600 mb-2">表示する列</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {columns.map(c => (
          <label
            key={c.id}
            className="inline-flex items-center gap-2 cursor-pointer select-none text-xs text-gray-700 whitespace-nowrap"
          >
            <input
              type="checkbox"
              className={postListFancyCheckboxSmClass}
              checked={isColumnVisible(visible, columns, c.id)}
              onChange={e => onToggle(c.id, e.target.checked)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

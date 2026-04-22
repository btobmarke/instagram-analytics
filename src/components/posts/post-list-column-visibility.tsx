'use client'

import { useCallback, useEffect, useState } from 'react'

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

export const SERVICE_POST_LIST_COLUMNS = [
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
  { id: 'replies', label: '返信' },
  { id: 'exits', label: '離脱' },
  { id: 'taps_forward', label: '次へ' },
  { id: 'taps_back', label: '戻る' },
  { id: 'postedAt', label: '投稿日' },
  { id: 'detail', label: '詳細' },
] as const

/** テーブル行・列トグル用のチェックボックス見た目 */
export const postListFancyCheckboxClass =
  'size-4 shrink-0 cursor-pointer rounded-md border-2 border-gray-300 bg-white accent-purple-600 transition-colors hover:border-purple-400 hover:bg-purple-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40'

/** 列トグル用（やや小さめ） */
export const postListFancyCheckboxSmClass =
  'size-[15px] shrink-0 cursor-pointer rounded-[5px] border-2 border-gray-300 bg-white accent-purple-600 transition-colors hover:border-purple-400 hover:bg-purple-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white'

export type DashboardPostListColumnId = (typeof DASHBOARD_POST_LIST_COLUMNS)[number]['id']
export type ServicePostListColumnId = (typeof SERVICE_POST_LIST_COLUMNS)[number]['id']

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
    return { ...base, ...parsed }
  } catch {
    return base
  }
}

export function usePostListColumnVisibility(storageKey: string, columns: readonly { id: string; label: string }[]) {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => defaultPostListColumnVisibility(columns))

  useEffect(() => {
    setVisible(loadMerged(storageKey, columns))
  }, [storageKey, columns])

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

  const isOn = useCallback((id: string) => visible[id] !== false, [visible])

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
              checked={visible[c.id] !== false}
              onChange={e => onToggle(c.id, e.target.checked)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

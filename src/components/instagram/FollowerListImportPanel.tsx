'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DEFAULT_IG_USERNAME_SPAN_CLASSES,
  extractFollowerUsernamesFromHtml,
} from '@/lib/instagram/extract-follower-usernames-from-html'

type FollowerListImportPanelProps = {
  accountId: string
  onImported?: () => void | Promise<void>
  /** HTML 貼り付け用テキストエリアの行数 */
  textareaRows?: number
  /** false のときは見出しバーを出さず（モーダル枠側でタイトル表示） */
  showHeading?: boolean
  /** true のとき外枠の白カードを付けない（モーダル内など） */
  unstyled?: boolean
}

/** Instagram フォロワー一覧の HTML 貼り付け取り込み（API PUT /api/accounts/[id]/followers） */
export function FollowerListImportPanel({
  accountId,
  onImported,
  textareaRows = 10,
  showHeading = true,
  unstyled = false,
}: FollowerListImportPanelProps) {
  const [followerHtml, setFollowerHtml] = useState('')
  const [followerClassNames, setFollowerClassNames] = useState(DEFAULT_IG_USERNAME_SPAN_CLASSES)
  const [followerPreview, setFollowerPreview] = useState('')
  const [followerCount, setFollowerCount] = useState<number | null>(null)
  const [followerUpdated, setFollowerUpdated] = useState<string | null>(null)
  const [savingFollowers, setSavingFollowers] = useState(false)
  const [resettingFollowers, setResettingFollowers] = useState(false)
  const [followerMsg, setFollowerMsg] = useState<string | null>(null)
  const [followerErr, setFollowerErr] = useState<string | null>(null)

  const fetchFollowerMeta = useCallback(async () => {
    const res = await fetch(`/api/accounts/${accountId}/followers`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return
    setFollowerCount(typeof j.count === 'number' ? j.count : 0)
    setFollowerUpdated(typeof j.last_updated_at === 'string' ? j.last_updated_at : null)
  }, [accountId])

  useEffect(() => {
    void fetchFollowerMeta()
  }, [fetchFollowerMeta])

  const runParseFollowers = () => {
    setFollowerErr(null)
    if (!followerClassNames.trim()) {
      setFollowerPreview('')
      setFollowerMsg('ユーザー名が載っている要素の class を入力してください')
      return
    }
    const list = extractFollowerUsernamesFromHtml(followerHtml, followerClassNames)
    setFollowerPreview(list.join('\n'))
    setFollowerMsg(
      list.length
        ? `${list.length.toLocaleString()} 件を検出しました（保存時に同じ条件で再解析して送信します）`
        : 'ユーザー名を検出できませんでした（class 名と HTML を確認してください）'
    )
  }

  const saveFollowers = async () => {
    setSavingFollowers(true)
    setFollowerErr(null)
    setFollowerMsg(null)
    try {
      if (!followerClassNames.trim()) {
        setFollowerErr('class を入力してください')
        return
      }
      const usernames = extractFollowerUsernamesFromHtml(followerHtml, followerClassNames)
      if (!usernames.length) {
        setFollowerErr('保存するユーザー名がありません。解析してプレビューで確認してください')
        return
      }
      const res = await fetch(`/api/accounts/${accountId}/followers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFollowerErr(typeof j.error === 'string' ? j.error : '保存に失敗しました')
        return
      }
      setFollowerMsg(`フォロワー ${typeof j.count === 'number' ? j.count.toLocaleString() : '0'} 件を保存しました`)
      await fetchFollowerMeta()
      await onImported?.()
    } finally {
      setSavingFollowers(false)
    }
  }

  const resetFollowers = async () => {
    const n = followerCount ?? 0
    if (n <= 0) return
    const ok = window.confirm(
      `保存済みのフォロワー ${n.toLocaleString()} 件をすべて削除します。取り消せません。続行しますか？`
    )
    if (!ok) return

    setResettingFollowers(true)
    setFollowerErr(null)
    setFollowerMsg(null)
    try {
      const res = await fetch(`/api/accounts/${accountId}/followers`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFollowerErr(typeof j.error === 'string' ? j.error : 'リセットに失敗しました')
        return
      }
      const deleted = typeof j.deleted === 'number' ? j.deleted : n
      setFollowerMsg(`フォロワー ${deleted.toLocaleString()} 件を削除しました（一覧は空です）`)
      setFollowerPreview('')
      await fetchFollowerMeta()
      await onImported?.()
    } finally {
      setResettingFollowers(false)
    }
  }

  const canSave =
    followerHtml.trim().length > 0 && followerClassNames.trim().length > 0 && !savingFollowers && !resettingFollowers

  const canReset =
    (followerCount ?? 0) > 0 && !savingFollowers && !resettingFollowers && followerCount != null

  const helpText = (
    <>
      開発者ツールでフォロワーモーダル内の HTML をコピーし、下に貼り付けます。
      ユーザー名が入っている要素の <strong>class</strong>（スペース区切りのまま）を入力すると、その
      class をすべて持つ要素のテキストからユーザー名を抽出します。Instagram の DOM が変わったときは class
      を取り直してください。
    </>
  )

  const body = (
    <>
      {showHeading ? (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">フォロワー一覧の取り込み</h3>
          <p className="text-xs text-gray-500 mt-1">{helpText}</p>
        </div>
      ) : null}
      <div
        className={`space-y-3 ${unstyled ? 'px-0 py-1' : showHeading ? 'p-4' : 'p-4 pt-4'}`}
      >
        {!showHeading && <p className="text-xs text-gray-500">{helpText}</p>}
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          {followerCount != null && <span>現在の保存件数: {followerCount.toLocaleString()} 名</span>}
          {followerUpdated && <span>最終更新: {new Date(followerUpdated).toLocaleString('ja-JP')}</span>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            ユーザー名要素の class（スペース区切り）
          </label>
          <input
            type="text"
            value={followerClassNames}
            onChange={(e) => setFollowerClassNames(e.target.value)}
            placeholder={DEFAULT_IG_USERNAME_SPAN_CLASSES}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">HTML</label>
          <textarea
            value={followerHtml}
            onChange={(e) => setFollowerHtml(e.target.value)}
            rows={textareaRows}
            placeholder="フォロワー一覧モーダル周辺の HTML を貼り付け…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runParseFollowers}
            disabled={resettingFollowers}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            解析してプレビュー
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={saveFollowers}
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
          >
            {savingFollowers ? '保存中…' : '保存（全件置換）'}
          </button>
          <button
            type="button"
            disabled={!canReset}
            onClick={() => void resetFollowers()}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-40 ml-auto"
          >
            {resettingFollowers ? '削除中…' : 'フォロワーをリセット'}
          </button>
        </div>
        {followerErr && <p className="text-sm text-red-600">{followerErr}</p>}
        {followerMsg && <p className="text-sm text-green-700">{followerMsg}</p>}
        {followerPreview && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">プレビュー（1行1ユーザー）</label>
            <textarea
              readOnly
              value={followerPreview}
              rows={Math.min(12, Math.max(4, followerPreview.split('\n').length))}
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50 text-gray-800"
            />
          </div>
        )}
      </div>
    </>
  )

  if (unstyled) {
    return <div className="space-y-0">{body}</div>
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">{body}</div>
  )
}

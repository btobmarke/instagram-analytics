'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import type { IgMediaManualInsightExtra } from '@/types'
import {
  DEFAULT_IG_USERNAME_SPAN_CLASSES,
  extractFollowerUsernamesFromHtml,
} from '@/lib/instagram/extract-follower-usernames-from-html'
import { parseManualInsightMetricsFromPaste } from '@/lib/instagram/parse-manual-insight-metrics-from-paste'

export type ManualInsightExtraModalProps = {
  open: boolean
  onClose: () => void
  mediaId: string
  /** Instagram 投稿URL（あれば表示し、別タブで開けます） */
  permalink?: string | null
  /** 保存成功後（詳細の一覧更新など） */
  onSaved?: () => void | Promise<void>
}

type FormState = {
  views_follower_pct: string
  views_non_follower_pct: string
  interactions_follower_pct: string
  interactions_non_follower_pct: string
  views_from_home: string
  views_from_profile: string
  views_from_other: string
  note: string
}

function emptyForm(): FormState {
  return {
    views_follower_pct: '',
    views_non_follower_pct: '',
    interactions_follower_pct: '',
    interactions_non_follower_pct: '',
    views_from_home: '',
    views_from_profile: '',
    views_from_other: '',
    note: '',
  }
}

/** 改行区切りのユーザー名を正規化してマージ（重複除去） */
function mergeUsernameLines(existing: string[], raw: string): string[] {
  const seen = new Set(existing.map(u => u.toLowerCase()))
  const out = [...existing]
  for (const line of raw.split(/\r?\n/)) {
    const u = line.trim().replace(/^@+/, '').toLowerCase()
    if (!u || !/^[a-z0-9._]{1,30}$/.test(u)) continue
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/** 空欄 → undefined、数値として不正 → null（呼び出し側でエラー扱い） */
function parsePct(s: string): number | undefined | null {
  const t = s.trim().replace(/%/g, '')
  if (t === '') return undefined
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return n
}

function parseIntField(s: string): number | undefined | null {
  const t = s.trim().replace(/,/g, '')
  if (t === '') return undefined
  const n = parseInt(t, 10)
  if (!Number.isFinite(n)) return null
  return n
}

export function ManualInsightExtraModal({ open, onClose, mediaId, permalink, onSaved }: ManualInsightExtraModalProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [insightMetricsPaste, setInsightMetricsPaste] = useState('')
  const [likedHtml, setLikedHtml] = useState('')
  const [likedClassNames, setLikedClassNames] = useState(DEFAULT_IG_USERNAME_SPAN_CLASSES)
  const [likedUsernames, setLikedUsernames] = useState<string[]>([])
  const [likedManualLines, setLikedManualLines] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(emptyForm())
      setInsightMetricsPaste('')
      setLikedHtml('')
      setLikedClassNames(DEFAULT_IG_USERNAME_SPAN_CLASSES)
      setLikedUsernames([])
      setLikedManualLines('')
      setError(null)
    }
  }, [open, mediaId])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      const views_follower_pct = parsePct(form.views_follower_pct)
      const views_non_follower_pct = parsePct(form.views_non_follower_pct)
      const interactions_follower_pct = parsePct(form.interactions_follower_pct)
      const interactions_non_follower_pct = parsePct(form.interactions_non_follower_pct)
      const views_from_home = parseIntField(form.views_from_home)
      const views_from_profile = parseIntField(form.views_from_profile)
      const views_from_other = parseIntField(form.views_from_other)

      const parsedFields = [
        views_follower_pct,
        views_non_follower_pct,
        interactions_follower_pct,
        interactions_non_follower_pct,
        views_from_home,
        views_from_profile,
        views_from_other,
      ]
      if (parsedFields.some(v => v === null)) {
        setError('数値の形式が正しくありません')
        return
      }

      const body: Record<string, unknown> = {}
      if (views_follower_pct !== undefined) body.views_follower_pct = views_follower_pct
      if (views_non_follower_pct !== undefined) body.views_non_follower_pct = views_non_follower_pct
      if (interactions_follower_pct !== undefined) body.interactions_follower_pct = interactions_follower_pct
      if (interactions_non_follower_pct !== undefined)
        body.interactions_non_follower_pct = interactions_non_follower_pct
      if (views_from_home !== undefined) body.views_from_home = views_from_home
      if (views_from_profile !== undefined) body.views_from_profile = views_from_profile
      if (views_from_other !== undefined) body.views_from_other = views_from_other
      const noteTrim = form.note.trim()
      if (noteTrim) body.note = noteTrim

      let mergedLikers = [...likedUsernames]
      if (likedManualLines.trim()) {
        mergedLikers = mergeUsernameLines(mergedLikers, likedManualLines)
      }
      if (mergedLikers.length > 3000) {
        setError('いいねユーザーは最大 3000 件までです')
        return
      }
      if (mergedLikers.length) body.liked_usernames = mergedLikers

      const hasMetric =
        body.views_follower_pct != null ||
        body.views_non_follower_pct != null ||
        body.interactions_follower_pct != null ||
        body.interactions_non_follower_pct != null ||
        body.views_from_home != null ||
        body.views_from_profile != null ||
        body.views_from_other != null ||
        mergedLikers.length > 0 ||
        noteTrim.length > 0

      if (!hasMetric) {
        setError('いずれかの項目を入力してください')
        return
      }

      for (const k of [
        'views_follower_pct',
        'views_non_follower_pct',
        'interactions_follower_pct',
        'interactions_non_follower_pct',
      ] as const) {
        const v = body[k]
        if (typeof v === 'number' && (v < 0 || v > 100)) {
          setError('パーセントは 0〜100 で入力してください')
          return
        }
      }

      setSaving(true)
      try {
        const res = await fetch(`/api/posts/${mediaId}/manual-insight-extra`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof json.error === 'string' ? json.error : '保存に失敗しました')
          return
        }
        await onSaved?.()
        onClose()
      } finally {
        setSaving(false)
      }
    },
    [form, likedUsernames, likedManualLines, mediaId, onClose, onSaved]
  )

  const runParseLikedHtml = useCallback(() => {
    setError(null)
    if (!likedClassNames.trim()) {
      setError('ユーザー名が載っている要素の class を入力してください')
      return
    }
    const parsed = extractFollowerUsernamesFromHtml(likedHtml, likedClassNames)
    if (parsed.length === 0) {
      setError(
        'HTML からユーザー名を検出できませんでした。いいね一覧周辺の HTML を貼り付け、class 名が DOM と一致しているか確認してください。'
      )
      return
    }
    setLikedUsernames(prev => {
      const seen = new Set(prev.map(u => u.toLowerCase()))
      const out = [...prev]
      for (const u of parsed) {
        if (seen.has(u)) continue
        seen.add(u)
        out.push(u)
      }
      return out
    })
  }, [likedHtml, likedClassNames])

  const removeLikedAt = (idx: number) => {
    setLikedUsernames(prev => prev.filter((_, i) => i !== idx))
  }

  const clearLikedList = () => {
    setLikedUsernames([])
    setLikedHtml('')
    setLikedClassNames(DEFAULT_IG_USERNAME_SPAN_CLASSES)
    setLikedManualLines('')
  }

  const applyInsightMetricsPaste = useCallback(() => {
    setError(null)
    const { patches, noteExtraLines } = parseManualInsightMetricsFromPaste(insightMetricsPaste)
    const noteAppend = noteExtraLines.join('\n').trim()
    if (Object.keys(patches).length === 0 && !noteAppend) {
      setError('この貼り付けからは認識できる項目がありませんでした')
      return
    }
    setForm(f => {
      const next: FormState = { ...f }
      for (const [k, v] of Object.entries(patches)) {
        if (v !== undefined && k in next) (next as Record<string, string>)[k] = v
      }
      if (noteAppend) {
        next.note = f.note.trim()
          ? `${f.note.trim()}\n\n--- 貼り付けで取得したその他の項目 ---\n${noteAppend}`
          : `--- 貼り付けで取得したその他の項目 ---\n${noteAppend}`
      }
      return next
    })
  }, [insightMetricsPaste])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-insight-extra-title"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[min(92vh,880px)] flex flex-col border border-gray-200 overflow-hidden">
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50/80 to-white">
          <div className="min-w-0 pr-2">
            <h2 id="manual-insight-extra-title" className="text-base font-semibold text-gray-900">
              手入力インサイト
            </h2>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              Graph API に無い内訳（ビューのフォロワー比率、閲覧の場所、いいねしたユーザー名など）をこの投稿用に保存します。保存のたびに<strong>1件の履歴</strong>が残ります。
            </p>
            <ul className="mt-2 text-xs text-gray-500 list-disc list-inside space-y-0.5">
              <li>下の欄に直接入力するか、折りたたみの「一括貼り付け」から数値だけ流し込めます。</li>
              <li>いいねユーザーは HTML ＋ class から解析してリストに追加できます。</li>
            </ul>
            {permalink ? (
              <p className="text-xs mt-3">
                <span className="text-gray-500">参照用: </span>
                <a
                  href={permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 font-medium hover:underline break-all"
                >
                  Instagram で開く
                </a>
              </p>
            ) : (
              <p className="text-xs text-amber-700 mt-3">投稿の permalink が無いため、Instagram へのリンクを表示できません。</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          <details className="rounded-xl border border-teal-100 bg-teal-50/50 overflow-hidden group">
            <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-teal-900 list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span>インサイト数値の一括貼り付け（任意）</span>
              <span className="text-xs font-normal text-teal-700 shrink-0">開いて貼り付け → 反映</span>
            </summary>
            <div className="px-4 pb-4 pt-0 border-t border-teal-100/80">
            <p className="text-xs text-gray-600 mb-2 leading-relaxed pt-3">
              Instagram の「ビュー」「インタラクション」「閲覧の場所」などをそのままコピーし、「入力欄に反映」で下の数値欄とメモに流し込みます。
            </p>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono min-h-[100px] bg-white"
              value={insightMetricsPaste}
              onChange={e => setInsightMetricsPaste(e.target.value)}
              placeholder={'ビュー\n760\nフォロワー\n62%\n…'}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={applyInsightMetricsPaste}
              className="mt-2 px-3 py-2 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              貼り付けから入力欄に反映
            </button>
            </div>
          </details>

          <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-800">数値（手入力）</h3>

          <section>
            <h4 className="text-xs font-medium text-gray-500 mb-2">ビュー — フォロワー比率</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-gray-500">
                フォロワー %
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.views_follower_pct}
                  onChange={e => setForm(f => ({ ...f, views_follower_pct: e.target.value }))}
                  placeholder="例: 64.6"
                />
              </label>
              <label className="block text-xs text-gray-500">
                フォロワー以外 %
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.views_non_follower_pct}
                  onChange={e => setForm(f => ({ ...f, views_non_follower_pct: e.target.value }))}
                  placeholder="例: 35.4"
                />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-medium text-gray-500 mb-2">インタラクション — フォロワー比率</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-gray-500">
                フォロワー %
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.interactions_follower_pct}
                  onChange={e => setForm(f => ({ ...f, interactions_follower_pct: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-gray-500">
                フォロワー以外 %
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.interactions_non_follower_pct}
                  onChange={e => setForm(f => ({ ...f, interactions_non_follower_pct: e.target.value }))}
                />
              </label>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-medium text-gray-500 mb-2">閲覧の場所（件数）</h4>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs text-gray-500">
                ホーム
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white"
                  value={form.views_from_home}
                  onChange={e => setForm(f => ({ ...f, views_from_home: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-gray-500">
                プロフィール
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white"
                  value={form.views_from_profile}
                  onChange={e => setForm(f => ({ ...f, views_from_profile: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-gray-500">
                その他
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white"
                  value={form.views_from_other}
                  onChange={e => setForm(f => ({ ...f, views_from_other: e.target.value }))}
                />
              </label>
            </div>
          </section>
          </div>

          <section className="border border-purple-100 rounded-xl p-4 bg-purple-50/40">
            <h3 className="text-sm font-semibold text-purple-900 mb-1">いいねしたユーザー</h3>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              開発者ツールで「いいね」一覧周辺の HTML をコピーし、ユーザー名要素の{' '}
              <strong>class</strong>（スペース区切り）を指定して「解析してリストに追加」してください。DOM が変わったら class を取り直します。
            </p>
            <label className="block text-xs text-gray-600 mb-1">
              ユーザー名要素の class（スペース区切り）
              <input
                type="text"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-white"
                value={likedClassNames}
                onChange={e => setLikedClassNames(e.target.value)}
                placeholder={DEFAULT_IG_USERNAME_SPAN_CLASSES}
                spellCheck={false}
              />
            </label>
            <label className="block text-xs text-gray-600 mt-3 mb-1">
              HTML
              <textarea
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono min-h-[140px] bg-white"
                value={likedHtml}
                onChange={e => setLikedHtml(e.target.value)}
                placeholder="いいね一覧モーダル周辺の HTML を貼り付け…"
                spellCheck={false}
              />
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={runParseLikedHtml}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                解析してリストに追加
              </button>
              <button
                type="button"
                onClick={clearLikedList}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                リストをクリア
              </button>
            </div>
            <label className="block text-xs text-gray-600 mt-4 mb-1">
              手動で追記（1行1ユーザー・英小文字に正規化されます）
              <textarea
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono min-h-[64px] bg-white"
                value={likedManualLines}
                onChange={e => setLikedManualLines(e.target.value)}
                placeholder={'user_one\nuser_two'}
                spellCheck={false}
              />
            </label>
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1.5">
                取り込み予定: <span className="font-semibold text-gray-800">{likedUsernames.length}</span> 名
                {likedManualLines.trim() && (
                  <span className="text-amber-700">（保存時に下の追記行もマージ）</span>
                )}
              </p>
              {likedUsernames.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-white rounded-lg border border-gray-100">
                  {likedUsernames.map((u, idx) => (
                    <span
                      key={`${u}-${idx}`}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-gray-100 text-xs text-gray-800"
                    >
                      @{u}
                      <button
                        type="button"
                        onClick={() => removeLikedAt(idx)}
                        className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                        aria-label={`${u} を削除`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">まだユーザーがリストにありません。</p>
              )}
            </div>
          </section>

          <label className="block text-xs font-medium text-gray-600">
            メモ（任意）
            <textarea
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[72px] bg-white"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="例: プロインサイト / 2026-04-10 時点"
              maxLength={2000}
            />
          </label>
          </div>

          <div className="shrink-0 border-t border-gray-200 bg-gray-50/95 px-5 py-3 space-y-2">
            {error ? <p className="text-sm text-red-600 leading-snug">{error}</p> : null}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-xl text-gray-700 bg-white hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto min-w-[140px] px-5 py-2.5 text-sm font-semibold rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 shadow-sm"
              >
                {saving ? '保存中…' : 'この内容で保存'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
}

function fmtInt(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('ja-JP')
}

function HistoryMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 min-w-0">
      <p className="text-xs text-gray-400 truncate" title={label}>
        {label}
      </p>
      <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{value}</p>
    </div>
  )
}

/** 投稿詳細などで手入力インサイト履歴をカード表示（主要指標エリアと同系のレイアウト） */
export function ManualInsightExtraHistoryTable({
  rows,
  emphasizeLatest = false,
}: {
  rows: IgMediaManualInsightExtra[]
  /** true のとき、先頭ブロック（通常は最新登録）を枠・背景で強調 */
  emphasizeLatest?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-8 text-center">
        <p className="text-sm text-gray-600">手入力の履歴はまだありません</p>
        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
          インサイト画面の数値やいいねユーザーを、上の「内訳を追加」から保存するとここに並びます。
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {rows.map((r, rowIdx) => {
        const isLatest = emphasizeLatest && rowIdx === 0
        const likers = r.liked_usernames ?? []
        const likerTitle = likers.length ? likers.map(u => `@${u}`).join(' ') : undefined
        return (
          <div
            key={r.id}
            className={`rounded-2xl border p-4 shadow-sm ${
              isLatest
                ? 'border-purple-200 bg-gradient-to-b from-purple-50/80 to-white ring-1 ring-purple-100/80'
                : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-xs font-medium text-gray-500">
                {new Date(r.recorded_at).toLocaleString('ja-JP')}
              </p>
              {isLatest ? (
                <span className="text-[10px] font-semibold text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-full">
                  最新
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <HistoryMetricCard label="ビュー · フォロワー %" value={fmtPct(r.views_follower_pct)} />
              <HistoryMetricCard label="ビュー · フォロワー以外 %" value={fmtPct(r.views_non_follower_pct)} />
              <HistoryMetricCard label="インタラクション · フォロワー %" value={fmtPct(r.interactions_follower_pct)} />
              <HistoryMetricCard
                label="インタラクション · フォロワー以外 %"
                value={fmtPct(r.interactions_non_follower_pct)}
              />
              <HistoryMetricCard label="閲覧の場所 · ホーム" value={fmtInt(r.views_from_home)} />
              <HistoryMetricCard label="閲覧の場所 · プロフィール" value={fmtInt(r.views_from_profile)} />
              <HistoryMetricCard label="閲覧の場所 · その他" value={fmtInt(r.views_from_other)} />
              <div
                className="bg-purple-50 rounded-xl p-3 min-w-0"
                title={likerTitle}
              >
                <p className="text-xs text-purple-600 truncate">いいねユーザー</p>
                <p className="text-lg font-bold text-purple-700 tabular-nums mt-0.5">
                  {likers.length > 0 ? `${likers.length.toLocaleString('ja-JP')} 名` : '—'}
                </p>
              </div>
              {r.note?.trim() ? (
                <div className="col-span-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                  <p className="text-xs text-gray-400 mb-1">メモ</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{r.note.trim()}</p>
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

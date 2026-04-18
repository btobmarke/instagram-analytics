'use client'

import { useState } from 'react'
import { FollowerListImportPanel } from '@/components/instagram/FollowerListImportPanel'

type InstagramFollowerImportButtonModalProps = {
  accountId: string | null | undefined
  /** 保存成功後（任意・例: SWR の再取得） */
  onImported?: () => void | Promise<void>
}

/** Instagram サービス各画面の見出し右用：フォロワー一覧取り込みモーダル */
export function InstagramFollowerImportButtonModal({
  accountId,
  onImported,
}: InstagramFollowerImportButtonModalProps) {
  const [open, setOpen] = useState(false)
  const id = accountId ?? undefined

  return (
    <>
      <button
        type="button"
        disabled={!id}
        onClick={() => setOpen(true)}
        title={!id ? 'アカウント連携後に利用できます' : undefined}
        className="flex-shrink-0 px-3 py-2 text-sm font-semibold rounded-xl border border-purple-200 bg-white text-purple-700 hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        フォロワー一覧を取り込む
      </button>

      {open && id && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="follower-import-modal-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[min(90vh,720px)] overflow-y-auto rounded-2xl bg-white shadow-xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-white rounded-t-2xl">
              <h2 id="follower-import-modal-title" className="text-sm font-semibold text-gray-900">
                フォロワー一覧の取り込み
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 pb-4">
              <FollowerListImportPanel
                accountId={id}
                showHeading={false}
                unstyled
                textareaRows={8}
                onImported={async () => {
                  await onImported?.()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

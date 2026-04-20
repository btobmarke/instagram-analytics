'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** LINE Messaging API の areas[] の1要素 */
export type LineRichMenuArea = {
  bounds: { x: number; y: number; width: number; height: number }
  action: Record<string, unknown>
}

type ActionKind = 'message' | 'uri' | 'postback'

export type AreaEditRow = {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  actionKind: ActionKind
  label: string
  messageText: string
  uri: string
  postbackData: string
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function roundBounds(b: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  }
}

export function parseLineAreasToRows(raw: unknown): AreaEditRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const a = item as { bounds?: LineRichMenuArea['bounds']; action?: Record<string, unknown> }
    const b = a.bounds ?? { x: 0, y: 0, width: 100, height: 100 }
    const act = a.action ?? { type: 'message', label: '', text: '' }
    const t = String(act.type ?? 'message')
    let actionKind: ActionKind = 'message'
    if (t === 'uri') actionKind = 'uri'
    else if (t === 'postback') actionKind = 'postback'
    return {
      id: newId(),
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      actionKind,
      label: String(act.label ?? ''),
      messageText: t === 'message' ? String(act.text ?? '') : '',
      uri: t === 'uri' ? String(act.uri ?? '') : '',
      postbackData: t === 'postback' ? String(act.data ?? '') : '',
    }
  })
}

export function rowsToLineAreas(rows: AreaEditRow[]): LineRichMenuArea[] {
  return rows.map((r) => {
    const bounds = roundBounds(r.bounds)
    let action: Record<string, unknown>
    if (r.actionKind === 'uri') {
      action = { type: 'uri', label: r.label.trim(), uri: r.uri.trim() }
    } else if (r.actionKind === 'postback') {
      action = {
        type: 'postback',
        label: r.label.trim(),
        data: r.postbackData.trim(),
      }
    } else {
      action = { type: 'message', label: r.label.trim(), text: r.messageText.trim() }
    }
    return { bounds, action }
  })
}

type DragSession =
  | {
      kind: 'move'
      id: string
      startClient: { x: number; y: number }
      startBounds: AreaEditRow['bounds']
    }
  | {
      kind: 'resize'
      id: string
      startBounds: AreaEditRow['bounds']
    }

const PRESET_SIZES: { label: string; w: number; h: number }[] = [
  { label: '2500 × 1686', w: 2500, h: 1686 },
  { label: '2500 × 843', w: 2500, h: 843 },
  { label: '843 × 2500（縦）', w: 843, h: 2500 },
]

export function RichMenuAreaEditor({
  menuWidth,
  menuHeight,
  areasJson,
  onAreasJsonChange,
  previewObjectUrl,
}: {
  menuWidth: number
  menuHeight: number
  areasJson: string
  onAreasJsonChange: (json: string) => void
  previewObjectUrl?: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<AreaEditRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<DragSession | null>(null)
  const skipSyncRef = useRef(false)

  const syncJsonToParent = useCallback(
    (nextRows: AreaEditRow[]) => {
      const areas = rowsToLineAreas(nextRows)
      skipSyncRef.current = true
      onAreasJsonChange(JSON.stringify(areas, null, 2))
    },
    [onAreasJsonChange],
  )

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    try {
      const parsed = JSON.parse(areasJson) as unknown
      if (!Array.isArray(parsed)) return
      const next = parseLineAreasToRows(parsed)
      setRows(next)
      setSelectedId((cur) => {
        if (cur && next.some((r) => r.id === cur)) return cur
        return next[0]?.id ?? null
      })
    } catch {
      /* ignore */
    }
  }, [areasJson])

  const updateBounds = useCallback(
    (id: string, bounds: AreaEditRow['bounds']) => {
      setRows((prev) => {
        const next = prev.map((r) =>
          r.id === id
            ? {
                ...r,
                bounds: roundBounds({
                  ...bounds,
                  x: clamp(bounds.x, 0, menuWidth - 1),
                  y: clamp(bounds.y, 0, menuHeight - 1),
                  width: clamp(bounds.width, 1, menuWidth - bounds.x),
                  height: clamp(bounds.height, 1, menuHeight - bounds.y),
                }),
              }
            : r,
        )
        syncJsonToParent(next)
        return next
      })
    },
    [menuHeight, menuWidth, syncJsonToParent],
  )

  const patchRow = useCallback(
    (id: string, patch: Partial<AreaEditRow>) => {
      setRows((prev) => {
        const next = prev.map((r) => {
          if (r.id !== id) return r
          const merged = { ...r, ...patch }
          if (patch.bounds) {
            const b = merged.bounds
            merged.bounds = roundBounds({
              x: clamp(b.x, 0, menuWidth - 1),
              y: clamp(b.y, 0, menuHeight - 1),
              width: clamp(b.width, 1, menuWidth - b.x),
              height: clamp(b.height, 1, menuHeight - b.y),
            })
          }
          return merged
        })
        syncJsonToParent(next)
        return next
      })
    },
    [menuHeight, menuWidth, syncJsonToParent],
  )

  const clientToMenu = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * menuWidth
      const y = ((clientY - rect.top) / rect.height) * menuHeight
      return { x: clamp(x, 0, menuWidth), y: clamp(y, 0, menuHeight) }
    },
    [menuWidth, menuHeight],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const p = clientToMenu(e.clientX, e.clientY)
      if (d.kind === 'move') {
        const dx = p.x - d.startClient.x
        const dy = p.y - d.startClient.y
        const sb = d.startBounds
        updateBounds(d.id, {
          x: clamp(sb.x + dx, 0, menuWidth - sb.width),
          y: clamp(sb.y + dy, 0, menuHeight - sb.height),
          width: sb.width,
          height: sb.height,
        })
      } else {
        const sb = d.startBounds
        const nw = clamp(p.x - sb.x, 1, menuWidth - sb.x)
        const nh = clamp(p.y - sb.y, 1, menuHeight - sb.y)
        updateBounds(d.id, { ...sb, width: nw, height: nh })
      }
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [clientToMenu, menuHeight, menuWidth, updateBounds])

  const addArea = () => {
    const w = Math.min(Math.floor(menuWidth * 0.35), menuWidth - 20)
    const h = Math.min(Math.floor(menuHeight * 0.22), menuHeight - 20)
    const row: AreaEditRow = {
      id: newId(),
      bounds: {
        x: Math.floor((menuWidth - w) / 2),
        y: Math.floor((menuHeight - h) / 2),
        width: w,
        height: h,
      },
      actionKind: 'message',
      label: 'ボタン',
      messageText: 'こんにちは',
      uri: 'https://',
      postbackData: 'action=default',
    }
    setRows((prev) => {
      const next = [...prev, row]
      syncJsonToParent(next)
      return next
    })
    setSelectedId(row.id)
  }

  const removeSelected = () => {
    if (!selectedId) return
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== selectedId)
      syncJsonToParent(next)
      return next
    })
    setSelectedId(null)
  }

  const onMouseDownArea = (e: React.MouseEvent, id: string, kind: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedId(id)
    const p = clientToMenu(e.clientX, e.clientY)
    const row = rows.find((r) => r.id === id)
    if (!row) return
    if (kind === 'move') {
      dragRef.current = {
        kind: 'move',
        id,
        startClient: p,
        startBounds: { ...row.bounds },
      }
    } else {
      dragRef.current = { kind: 'resize', id, startBounds: { ...row.bounds } }
    }
  }

  const selected = rows.find((r) => r.id === selectedId) ?? null

  const aspectLabel = useMemo(
    () => `${menuWidth} × ${menuHeight}`,
    [menuWidth, menuHeight],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addArea}
          className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
        >
          エリアを追加
        </button>
        <button
          type="button"
          onClick={removeSelected}
          disabled={!selectedId}
          className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded-lg disabled:opacity-40"
        >
          選択を削除
        </button>
        <span className="text-xs text-gray-500">キャンバス比率: {aspectLabel}</span>
      </div>

      <div
        ref={containerRef}
        className="relative w-full max-w-3xl mx-auto border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 select-none touch-none"
        style={{
          aspectRatio: `${menuWidth} / ${menuHeight}`,
        }}
        onMouseDown={() => setSelectedId(null)}
      >
        {previewObjectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewObjectUrl}
            alt="リッチメニュー画像プレビュー"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 p-4 text-center">
            下の「画像を選ぶ」で背景を表示できます（任意）
          </div>
        )}
        {rows.map((r) => {
          const left = (r.bounds.x / menuWidth) * 100
          const top = (r.bounds.y / menuHeight) * 100
          const w = (r.bounds.width / menuWidth) * 100
          const h = (r.bounds.height / menuHeight) * 100
          const isSel = r.id === selectedId
          return (
            <div
              key={r.id}
              className={`absolute box-border ${
                isSel ? 'ring-2 ring-green-500 ring-offset-1' : 'ring-1 ring-white/80'
              }`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${w}%`,
                height: `${h}%`,
                backgroundColor: isSel ? 'rgba(34,197,94,0.25)' : 'rgba(59,130,246,0.2)',
              }}
              onMouseDown={(e) => onMouseDownArea(e, r.id, 'move')}
            >
              <span className="absolute left-0.5 top-0.5 text-[10px] leading-tight text-white drop-shadow-md truncate max-w-[95%] pointer-events-none">
                {r.label || '（無題）'}
              </span>
              {isSel && (
                <div
                  className="absolute -right-1 -bottom-1 w-4 h-4 bg-green-600 border-2 border-white rounded-sm cursor-nwse-resize z-10"
                  onMouseDown={(e) => onMouseDownArea(e, r.id, 'resize')}
                />
              )}
            </div>
          )
        })}
      </div>

      {selected && (
        <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3 max-w-xl">
          <p className="text-sm font-semibold text-gray-800">選択中のエリア</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <label>
              x
              <input
                type="number"
                value={selected.bounds.x}
                onChange={(e) =>
                  patchRow(selected.id, {
                    bounds: { ...selected.bounds, x: Number(e.target.value) || 0 },
                  })
                }
                className="w-full mt-0.5 px-2 py-1 border rounded font-mono"
              />
            </label>
            <label>
              y
              <input
                type="number"
                value={selected.bounds.y}
                onChange={(e) =>
                  patchRow(selected.id, {
                    bounds: { ...selected.bounds, y: Number(e.target.value) || 0 },
                  })
                }
                className="w-full mt-0.5 px-2 py-1 border rounded font-mono"
              />
            </label>
            <label>
              width
              <input
                type="number"
                value={selected.bounds.width}
                onChange={(e) =>
                  patchRow(selected.id, {
                    bounds: { ...selected.bounds, width: Number(e.target.value) || 1 },
                  })
                }
                className="w-full mt-0.5 px-2 py-1 border rounded font-mono"
              />
            </label>
            <label>
              height
              <input
                type="number"
                value={selected.bounds.height}
                onChange={(e) =>
                  patchRow(selected.id, {
                    bounds: { ...selected.bounds, height: Number(e.target.value) || 1 },
                  })
                }
                className="w-full mt-0.5 px-2 py-1 border rounded font-mono"
              />
            </label>
          </div>
          <div>
            <label className="text-xs text-gray-600">アクション</label>
            <select
              value={selected.actionKind}
              onChange={(e) =>
                patchRow(selected.id, { actionKind: e.target.value as ActionKind })
              }
              className="block w-full mt-1 px-3 py-2 text-sm border rounded-lg bg-white"
            >
              <option value="message">メッセージを送信</option>
              <option value="uri">リンクを開く（URI）</option>
              <option value="postback">postback</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600">ラベル（表示名）</label>
            <input
              value={selected.label}
              onChange={(e) => patchRow(selected.id, { label: e.target.value })}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-lg"
            />
          </div>
          {selected.actionKind === 'message' && (
            <div>
              <label className="text-xs text-gray-600">送信テキスト</label>
              <input
                value={selected.messageText}
                onChange={(e) => patchRow(selected.id, { messageText: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-lg"
              />
            </div>
          )}
          {selected.actionKind === 'uri' && (
            <div>
              <label className="text-xs text-gray-600">URL</label>
              <input
                type="url"
                value={selected.uri}
                onChange={(e) => patchRow(selected.id, { uri: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-lg"
              />
            </div>
          )}
          {selected.actionKind === 'postback' && (
            <div>
              <label className="text-xs text-gray-600">data（postback-bindings の data_key と一致）</label>
              <input
                value={selected.postbackData}
                onChange={(e) => patchRow(selected.id, { postbackData: e.target.value })}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-lg font-mono"
              />
            </div>
          )}
        </div>
      )}

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer text-gray-700 font-medium">プリセットサイズ（LINE 公式の例）</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          {PRESET_SIZES.map((p) => (
            <li key={p.label}>
              {p.label} — 下の「メニューサイズ」幅・高さを {p.w} / {p.h} に合わせてください
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

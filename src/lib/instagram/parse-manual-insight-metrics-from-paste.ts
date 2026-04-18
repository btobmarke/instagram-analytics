/**
 * Instagram 管理画面からコピーした「ビュー／インタラクション／プロフィール」系のテキストから、
 * 手入力インサイト用のフィールド値を抽出する（AI 不使用）。
 */

export type ManualInsightMetricPatches = {
  views_follower_pct?: string
  views_non_follower_pct?: string
  interactions_follower_pct?: string
  interactions_non_follower_pct?: string
  views_from_home?: string
  views_from_profile?: string
  views_from_other?: string
}

function isPctValue(s: string): boolean {
  return /^\d+(\.\d+)?%?$/.test(s.trim())
}

function isIntValue(s: string): boolean {
  return /^-?\d[\d,]*$/.test(s.trim().replace(/,/g, ''))
}

function stripPct(s: string): string {
  return s.trim().replace(/%/g, '')
}

function stripInt(s: string): string {
  return s.trim().replace(/,/g, '')
}

/** ラベル行の直後が数値・％でないときは 1 行だけ進める（例: 単独の「プロフィール」見出し） */
function skipNonPairProfileHeader(lines: string[], i: number): number {
  const L = lines[i]
  const next = lines[i + 1]
  if (L === 'プロフィール' && next !== undefined && !isIntValue(next) && !isPctValue(next)) {
    return 1
  }
  return 0
}

/**
 * 空行を除いた行を先頭から走査し、ラベル＋値のペアを読む。
 * 「インタラクション」「インタラクション」「16」のようにラベルが重なる行は 3 行まとめてスキップ。
 * 同じラベル（フォロワー% 等）がビュー用とインタラクション用で二度出るため、
 * 重複「インタラクション」ブロックより前をビュー、以降をインタラクションとみなす。
 */
export function parseManualInsightMetricsFromPaste(text: string): {
  patches: ManualInsightMetricPatches
  /** フォームに無い項目をメモ用に返す（改行区切り） */
  noteExtraLines: string[]
} {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  const patches: ManualInsightMetricPatches = {}
  const noteExtraLines: string[] = []

  const intrDoubleIdx = lines.findIndex(
    (l, i) => l === 'インタラクション' && lines[i + 1] === 'インタラクション'
  )
  const reachIdx = lines.findIndex(l => l === 'リーチしたアカウント数')
  /** インタラクション（比率）ブロックの開始行インデックス */
  const splitAt =
    intrDoubleIdx >= 0 ? intrDoubleIdx : reachIdx >= 0 ? reachIdx + 2 : lines.length
  const beforeInteractionBlock = (idx: number) => idx < splitAt

  let i = 0
  while (i < lines.length) {
    const adv = skipNonPairProfileHeader(lines, i)
    if (adv) {
      i += adv
      continue
    }

    if (lines[i] === 'インタラクション' && lines[i + 1] === 'インタラクション') {
      const total = lines[i + 2]
      if (total !== undefined && isIntValue(total)) {
        noteExtraLines.push(`インタラクション（合計）: ${stripInt(total)}`)
      }
      i += 3
      continue
    }

    const L = lines[i]
    const V = lines[i + 1]
    if (V === undefined) break

    if (L === 'ビュー' || L === 'リーチしたアカウント数') {
      i += 2
      continue
    }

    if (L === 'フォロワー' && isPctValue(V)) {
      if (beforeInteractionBlock(i)) patches.views_follower_pct = stripPct(V)
      else patches.interactions_follower_pct = stripPct(V)
      i += 2
      continue
    }

    if (L === 'フォロワー以外' && isPctValue(V)) {
      if (beforeInteractionBlock(i)) patches.views_non_follower_pct = stripPct(V)
      else patches.interactions_non_follower_pct = stripPct(V)
      i += 2
      continue
    }

    if (L === 'その他' && isIntValue(V)) {
      patches.views_from_other = stripInt(V)
      i += 2
      continue
    }

    if (L === 'ホーム' && isIntValue(V)) {
      patches.views_from_home = stripInt(V)
      i += 2
      continue
    }

    if (L === 'プロフィール' && isIntValue(V)) {
      patches.views_from_profile = stripInt(V)
      i += 2
      continue
    }

    if (
      L === '投稿でのインタラクション' ||
      L === '「いいね！」' ||
      L === '保存数' ||
      L === 'コメント' ||
      L === 'シェア数' ||
      L === 'プロフィールのアクティビティ' ||
      L === 'プロフィールへのアクセス' ||
      L === '外部リンクのタップ数' ||
      L === 'ビジネスの住所のタップ数' ||
      L === 'フォロー数'
    ) {
      if (isIntValue(V) || isPctValue(V)) {
        noteExtraLines.push(`${L}: ${V}`)
      }
      i += 2
      continue
    }

    // その他のラベル＋値はメモ候補
    if (isIntValue(V) || isPctValue(V)) {
      noteExtraLines.push(`${L}: ${V}`)
    }
    i += 2
  }

  return { patches, noteExtraLines }
}

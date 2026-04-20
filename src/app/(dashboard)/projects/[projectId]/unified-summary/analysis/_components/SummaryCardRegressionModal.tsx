'use client'

import { useMemo, useState } from 'react'

export type PenaltyType = 'ridge' | 'lasso' | 'elastic_net' | 'ols'

export type CvPattern = {
  penaltyType: PenaltyType
  lambda: number
  elasticAlpha: number | null
  meanRmse: number
  foldRmses: number[]
  kFolds: number
}

export type ModelRunSpec = {
  penaltyType: PenaltyType
  lambda: number
  elasticAlpha: number | null
  modelName: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  cardTitle: string
  projectId: string
  treeId: string
  parentNodeId: string
  timeUnit: 'day' | 'week' | 'month'
  rangeStart: string
  rangeEnd: string
  onCommitted: () => Promise<void>
}

/** プリセット分析に近い 0〜20 の線形 λ（UI スライダー） */
const RIDGE_LINEAR_MAX = 20

/** 対数スケール λ（スライダー 0..100 → log10 -4 .. 2） */
function logSliderToLambda(slider: number): number {
  const t = slider / 100
  const logLam = -4 + t * 6
  return Math.pow(10, logLam)
}

function lambdaToLogSlider(lam: number): number {
  const logLam = Math.log10(Math.max(1e-4, Math.min(1e2, lam)))
  return ((logLam + 4) / 6) * 100
}

function buildCvCandidatePatterns(
  penaltyType: PenaltyType,
  lambda: number,
  elasticAlpha: number,
): Array<{ penaltyType: PenaltyType; lambda: number; elasticAlpha: number | null }> {
  if (penaltyType === 'ols') {
    return [{ penaltyType: 'ols', lambda: 0, elasticAlpha: null }]
  }
  const logLams = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]
  const lambdas = logLams.map(ex => Math.pow(10, ex))
  if (penaltyType === 'ridge' || penaltyType === 'lasso') {
    return lambdas.map(l => ({ penaltyType, lambda: l, elasticAlpha: null }))
  }
  const alphas = [0.2, 0.35, 0.5, 0.65, 0.8]
  const out: Array<{ penaltyType: PenaltyType; lambda: number; elasticAlpha: number | null }> = []
  for (const a of alphas) {
    for (const l of lambdas) {
      out.push({ penaltyType: 'elastic_net', lambda: l, elasticAlpha: a })
    }
  }
  return out.slice(0, 48)
}

function patternKey(p: { penaltyType: string; lambda: number; elasticAlpha: number | null }) {
  return `${p.penaltyType}:${p.lambda}:${p.elasticAlpha ?? ''}`
}

export function SummaryCardRegressionModal({
  open,
  onClose,
  cardTitle,
  projectId,
  treeId,
  parentNodeId,
  timeUnit,
  rangeStart,
  rangeEnd,
  onCommitted,
}: Props) {
  const [penaltyType, setPenaltyType] = useState<PenaltyType>('elastic_net')
  const [ridgeLinear, setRidgeLinear] = useState(1)
  const [logLambdaSlider, setLogLambdaSlider] = useState(() => lambdaToLogSlider(0.1))
  const [elasticAlpha, setElasticAlpha] = useState(0.5)
  const [kFolds, setKFolds] = useState(5)
  const [cvLoading, setCvLoading] = useState(false)
  const [cvPatterns, setCvPatterns] = useState<CvPattern[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [runLoading, setRunLoading] = useState(false)
  const [cvError, setCvError] = useState<string | null>(null)

  const currentLambda = useMemo(() => {
    if (penaltyType === 'ols') return 0
    if (penaltyType === 'ridge') return ridgeLinear
    return logSliderToLambda(logLambdaSlider)
  }, [penaltyType, ridgeLinear, logLambdaSlider])

  const currentPattern = useMemo(
    () => ({
      penaltyType,
      lambda: currentLambda,
      elasticAlpha: penaltyType === 'elastic_net' ? elasticAlpha : null,
    }),
    [penaltyType, currentLambda, elasticAlpha],
  )

  if (!open) return null

  const runCv = async () => {
    setCvError(null)
    setCvLoading(true)
    try {
      const candidates = buildCvCandidatePatterns(penaltyType, currentLambda, elasticAlpha)
      const res = await fetch(`/api/projects/${projectId}/summary-cards/analysis/cv`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          treeId,
          parentNodeId,
          timeUnit,
          rangeStart,
          rangeEnd,
          kFolds,
          patterns: candidates,
        }),
      }).then(r => r.json())
      if (!res.success) {
        setCvError(res.message ?? res.error ?? 'CV に失敗しました')
        setCvPatterns([])
        return
      }
      const list = (res.data?.patterns ?? []) as CvPattern[]
      const sorted = [...list].sort((a, b) => a.meanRmse - b.meanRmse)
      setCvPatterns(sorted)
      const top = sorted.filter(p => Number.isFinite(p.meanRmse)).slice(0, 3)
      setSelectedKeys(new Set(top.map(p => patternKey(p))))
    } finally {
      setCvLoading(false)
    }
  }

  const toggleKey = (k: string) => {
    setSelectedKeys(prev => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  const addCurrentToSelection = () => {
    const k = patternKey(currentPattern)
    setSelectedKeys(prev => new Set(prev).add(k))
  }

  const runAnalysis = async () => {
    const specs: ModelRunSpec[] = []
    const seen = new Set<string>()

    const pushSpec = (p: { penaltyType: PenaltyType; lambda: number; elasticAlpha: number | null }) => {
      const k = patternKey(p)
      if (seen.has(k)) return
      seen.add(k)
      const name =
        p.penaltyType === 'elastic_net'
          ? `EN λ=${p.lambda.toExponential(2)} α=${p.elasticAlpha}`
          : p.penaltyType === 'ols'
            ? 'OLS'
            : `${p.penaltyType} λ=${p.penaltyType === 'ridge' ? p.lambda : p.lambda.toExponential(2)}`
      specs.push({
        penaltyType: p.penaltyType,
        lambda:      p.penaltyType === 'ols' ? 0 : p.lambda,
        elasticAlpha: p.elasticAlpha,
        modelName:    name,
      })
    }

    for (const p of cvPatterns) {
      if (selectedKeys.has(patternKey(p))) {
        pushSpec({
          penaltyType: p.penaltyType,
          lambda:      p.lambda,
          elasticAlpha: p.elasticAlpha,
        })
      }
    }

    if (specs.length === 0) {
      pushSpec(currentPattern)
    }

    setRunLoading(true)
    setCvError(null)
    try {
      const cvSummary = {
        kFolds,
        evaluatedAt: new Date().toISOString(),
        patterns: cvPatterns.map(p => ({
          key: patternKey(p),
          ...p,
          selected: selectedKeys.has(patternKey(p)),
        })),
      }
      const res = await fetch(`/api/projects/${projectId}/summary-cards/analysis/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          treeId,
          parentNodeId,
          timeUnit,
          rangeStart,
          rangeEnd,
          models: specs,
          cvSummary,
        }),
      }).then(r => r.json())
      if (!res.success) {
        setCvError(res.message ?? res.error ?? '分析の保存に失敗しました')
        return
      }
      await onCommitted()
      onClose()
    } finally {
      setRunLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">重回帰分析</div>
            <div className="text-xs text-gray-500 truncate max-w-[280px]">{cardTitle}</div>
          </div>
          <button type="button" className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">手法</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['ols', 'OLS'],
                  ['ridge', 'Ridge'],
                  ['lasso', 'Lasso'],
                  ['elastic_net', 'ElasticNet'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 border rounded-md px-2 py-1.5 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="penalty"
                    checked={penaltyType === v}
                    onChange={() => setPenaltyType(v)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {penaltyType === 'ridge' && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                Ridge λ（0〜20、プリセット分析と同様の線形スライダー）
              </div>
              <input
                type="range"
                min={0}
                max={RIDGE_LINEAR_MAX}
                step={0.5}
                value={ridgeLinear}
                onChange={e => setRidgeLinear(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-600 mt-1">λ = {ridgeLinear}</div>
            </div>
          )}

          {(penaltyType === 'lasso' || penaltyType === 'elastic_net') && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                {penaltyType === 'lasso' ? 'Lasso' : 'ElasticNet'} λ（対数スケール 10⁻⁴〜10²）
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={logLambdaSlider}
                onChange={e => setLogLambdaSlider(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-600 mt-1">λ ≈ {logSliderToLambda(logLambdaSlider).toExponential(3)}</div>
            </div>
          )}

          {penaltyType === 'elastic_net' && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">ElasticNet α（0=L2寄り、1=L1寄り）</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={elasticAlpha}
                onChange={e => setElasticAlpha(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-600 mt-1">α = {elasticAlpha.toFixed(2)}</div>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">交差検証の分割数（時系列ブロック K-fold）</div>
            <select
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              value={kFolds}
              onChange={e => setKFolds(parseInt(e.target.value, 10))}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => (
                <option key={k} value={k}>
                  K = {k}
                </option>
              ))}
            </select>
          </div>

          {cvError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">{cvError}</div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 text-sm disabled:opacity-50"
              disabled={cvLoading}
              onClick={runCv}
            >
              {cvLoading ? '検証中…' : 'クロスバリデーション検証'}
            </button>
            <button type="button" className="px-3 py-1.5 rounded-md border bg-gray-50 hover:bg-gray-100 text-sm" onClick={addCurrentToSelection}>
              現在の設定を候補に追加
            </button>
          </div>

          {cvPatterns.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-2">CV 結果（平均 RMSE 昇順・分析決定で保存するモデルにチェック）</div>
              <div className="max-h-48 overflow-y-auto border rounded-md divide-y text-xs">
                {cvPatterns.map(p => {
                  const k = patternKey(p)
                  const finite = Number.isFinite(p.meanRmse)
                  return (
                    <label key={k} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(k)}
                        onChange={() => toggleKey(k)}
                      />
                      <span className="flex-1 font-mono truncate">
                        {p.penaltyType}
                        {p.elasticAlpha != null ? ` α=${p.elasticAlpha}` : ''} λ={p.lambda < 0.01 ? p.lambda.toExponential(1) : p.lambda.toFixed(3)}
                      </span>
                      <span className={finite ? 'text-gray-800' : 'text-gray-400'}>
                        {finite ? p.meanRmse.toFixed(4) : '—'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={onClose} disabled={runLoading}>
              キャンセル
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-700 disabled:opacity-50"
              disabled={runLoading}
              onClick={runAnalysis}
            >
              {runLoading ? '実行中…' : '分析決定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

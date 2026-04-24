# サマリ条件付き集計（`conditionalAggregate`）仕様

サービス詳細サマリ／横断サマリのカスタム指標で、**通常の `table.field` 集計では表現しづらい「条件を満たす行だけを数える／合算する」** を、`definitionId` ごとの実装として差し込める枠組みです。

## 目的

- 新しいテーブル向けの集計を足すとき、**`fetch-metrics.ts` にテーブル専用の分岐を増やし続けない**。
- **仕様（パラメータ）と実装（クエリ・集計）** を `definitionId` 単位でまとめる。
- サービス詳細・横断サマリで **同じ仮想 ref** を使って値を取得する。

## データモデル（カスタム指標の `formula`）

`FormulaNode` に次を保存する（API は `formula-zod` で検証）。

| フィールド | 説明 |
|------------|------|
| `conditionalAggregate` | `{ definitionId: string, params: Record<string, unknown> }`。設定時は**四則の `steps` は評価に使わない**（UI ではダミー 1 段を入れてよい）。 |
| `cumulativeUsersSliceRef` | **非推奨・互換のみ**。旧保存データの読み取り用。内部では `conditionalAggregate` と同じ仮想 ref に正規化される（後述）。 |

## 仮想メトリクス ref（フェッチキー）

クライアント・`fetchMetricsByRefs` は、次の形式の文字列を **1 本のメトリクスキー** として扱う。

```text
summary@cond:v1:<base64url(JSON)>
```

JSON の先頭に必ず **`definitionId`** を含め、残りはその定義専用の `params` とする（`encodeSummaryConditionalRef` が `{ definitionId, ...params }` をシリアライズする）。

- **エンコード／デコード**: `src/lib/summary/summary-conditional-ref.ts`
- **式 → フェッチ用 ref の解決**: `src/lib/summary/summary-formula-data-ref.ts` の `resolveSummaryFormulaDataRef`

## 「対象日」（期間列ごとの評価日）

条件付き集計の多くは **「その列が表す暦日のスナップショット」** で判定する。

| テンプレの `timeUnit` | 対象日（JST 暦日 `YYYY-MM-DD`） |
|----------------------|----------------------------------|
| `day` | その列の日付（`Period.dateKey` があればそれを使用） |
| `week` / `month` / `hour` | 期間の **終端**が属する暦日（`Period.rangeEnd` があればそれ、なければ `end` の直前の瞬間から JST 日付を算出） |
| `custom_range` | `rangeEnd`（両端含むレンジの終端日） |

実装の基準関数は `summary-conditional-definitions.ts` 内の `periodAsOfDateKeyJst`（`SummaryConditionalPeriod`）と同等の考え方。

## 集計の流れ（ランタイム）

1. テンプレ／カスタム指標の式から `collectFormulaOperandRefs` / `collectFormulaMetricRefs` が **仮想 ref**（`summary@cond:v1:…`）を列挙する（中身は `resolveSummaryFormulaDataRef`）。
2. `fetchMetricsByRefs` が ref を走査し、`summary@cond:` で始まるものを **`fetchSummaryConditionalMetrics`** に渡す。
3. `src/lib/summary/summary-conditional-definitions.ts` の **`fetchers[definitionId]`** が Supabase クエリと集計を行い、`{ [ref]: { [periodLabel]: number | null } }` を返す。
4. `evalSummaryFormula` / `evalServiceSummaryFormula` が同じ ref のセル値を読む。

## 実装ファイルの地図

| ファイル | 役割 |
|----------|------|
| `src/lib/summary/formula-types.ts` | `FormulaConditionalAggregate` / `FormulaNode` |
| `src/lib/summary/formula-zod.ts` | API 用 `FormulaNodeSchema`（`conditionalAggregate` を許可） |
| `src/lib/summary/summary-conditional-ref.ts` | 仮想 ref の encode / parse |
| `src/lib/summary/summary-formula-data-ref.ts` | 式から仮想 ref へ（新形式＋旧形式の正規化） |
| `src/lib/summary/summary-conditional-definitions.ts` | **`definitionId` 定数・Zod・`fetchers`・文言ヘルパ** |
| `src/lib/summary/fetch-metrics.ts` | `summary@cond:` を検出して `fetchSummaryConditionalMetrics` を呼ぶ |
| `src/lib/summary/eval-formula.ts` / `eval-service-formula.ts` | 仮想 ref 経由でセル値を返す |
| `src/lib/summary/formula-humanize.ts` | モーダル用短文（`humanizeConditionalAggregate`） |
| `src/app/.../summary/_lib/types.ts` の `formatFormula` | 一覧用の短い表示名 |
| `src/app/.../unified-summary/_lib/collect-template-field-refs.ts` | 横断で `summary@cond:` をフェッチ対象に含める |
| `src/app/.../summary/[templateId]/view/page.tsx` | `isSummaryDataFieldRef` に `summary@cond:` を含める |

## 新しいテーブル／集計を足す手順（チェックリスト）

以下を **同じ PR または小さな PR** でまとめると迷いにくい。

### 1. `definitionId` を決める

- **安定したスネークケース英字**推奨（例: `line_oam_shopcard_point_cond_sum`）。
- 既存と重複しないこと。
- 定数として `summary-conditional-definitions.ts` の先頭付近に `export const DEF_... = '...' as const` を置くと import しやすい。

### 2. `params` の Zod スキーマを定義する

- `summary-conditional-definitions.ts` に `YourParamsSchema = z.object({ ... })` を追加。
- **比較対象の列名・演算子・閾値・集約列（sum / count 等）** を明示的にフィールド化する（マジックキーを減らす）。

### 3. `fetchers[definitionId]` を実装する

- シグネチャは既存の `line_oam_shopcard_point_cond_sum` と同様:  
  `(supabase, serviceId, instances, periods) => Promise<Record<ref, Record<label, number|null>>>`
- `instances` は `{ ref, params }[]`。**同じ params の組み合わせはクエリをまとめてよい**（既存実装のパターン）。
- **循環 import 禁止**: このファイルから `fetch-metrics.ts` を import しない。Supabase 型は `SummaryConditionalSupabase` を使う。
- 期間は `SummaryConditionalPeriod` と **`periodAsOfDateKeyJst` と同じ解釈**に揃えるか、定義ごとに仕様をコメントで固定する。

### 4. 文言・表示名（任意だが推奨）

- `humanizeConditionalAggregate(definitionId, params, findLabel)` に分岐を追加（モーダル「この指標の意味」）。
- `formatConditionalAggregateSummary(definitionId, params)` に分岐を追加（`formatFormula` のラベル用）。

### 5. UI（必要なときだけ）

- サービス詳細のカスタム指標モーダル（`summary/[templateId]/page.tsx` の `FormulaBuilderModal`）から  
  `conditionalAggregate: { definitionId, params }` を保存する。
- **カタログの既存指標だけで十分なら** UI を増やさず、API や DB マイグレーションだけで新定義を使うことも可能（上級者向け）。

### 6. 横断サマリ・ビュー

- 仮想 ref は **`isUnifiedSummaryScalarMetricRef` / `isSummaryDataFieldRef`** が `summary@cond:` を許可していれば追加作業は不要なことが多い。新しいプレフィックスにした場合はここを更新。

### 7. テスト

- `summary-conditional-ref.test.ts`: encode/decode が壊れていないか。
- `summary-conditional-definitions.ts` に複雑な正規化があるなら **そのファイル用の unit test** を追加。
- `eval-formula.test.ts` など: 少なくとも **collect refs と eval が一貫しているか** を 1 本。

## 組み込み定義（現時点）

### `line_oam_shopcard_point_cond_sum`

- **意味**: `line_oam_shopcard_point` について、**対象日**の行のうち `point` が条件を満たすものの **`users` をリワードカード横断で合算**。
- **params スキーマ**: `LineShopcardPointSliceParamsSchema`  
  - `compareField`: 現状は `'point'` のみ  
  - `compareOp`: `'eq' | 'gte' | 'lte' | 'gt' | 'lt'`  
  - `compareValue`: 整数  
  - `sumField`: 現状は `'users'` のみ  

UI 上の「ポイント分布（人数）」はこの定義を保存する。

## 旧形式（互換）

`line_oam_shopcard_point.cumulative_users@{op}:{threshold}` 形式の **`cumulativeUsersSliceRef`** が残っている行は、フェッチ時に **`line_oam_shopcard_point_cond_sum` と同じ仮想 ref** に正規化される。新規作成では `conditionalAggregate` のみを使うこと。

## 関連ドキュメント

- 横断サマリ全般: `docs/unified-summary-*.md`
- サマリ画面のルーティング概要: `src/app/(dashboard)/manual/services/summary/page.tsx`（マニュアル用）

# 横断サマリ（サマリカード）分析ボタン機能 仕様書

最終更新: 2026-04-14

本書は、横断サマリの「サマリカード」画面における **分析ボタン（回帰分析）** と、**検証（Validation）**、**AI評価連携**までを一貫した仕様として定義する。

前提のサマリカード仕様は `docs/unified-summary-summary-cards-spec.md` を参照。

---

## 0. 目的

- KPIツリー由来のサマリカード（親=目的、子=要因）単位で、指定期間の回帰分析を実行できるようにする
- 分析は初心者でも理解できるように、**式**と**ビジュアル**で結果を提示する
- 分析が進んだら条件（集計粒度・期間）を固定し、検証（残差評価）へ進める導線を作る
- 検証にAI評価オプションを付け、バッチで評価コメントを生成できるようにする

---

## 1. 用語定義（重要）

### 1.1 サマリカード（分析単位）

KPIツリーの「親ノード1つ」を中心に、直下の子を要因として表示するカード。

- 親が `metricRef` を持つ場合
  - 親 = **Y（目的変数）**
  - 子（leaf展開後） = **X（説明変数）**
- 親が folder で `metricRef` が無い場合
  - **Y不在** → 回帰不可

### 1.2 観測数 / 変数数

- 観測数 \(n\): 期間点の数（例: 日次で 14日なら n=14）
- 変数数 \(p\): X（説明変数）の本数（子指標の数）

---

## 2. 分析ボタン（カード単位回帰）の仕様

### 2.1 分析の入力

分析ボタン押下時点で画面が保持する以下を入力とする。

- `timeUnit`: `day | week | month`
- `dateRange`: `rangeStart`〜`rangeEnd`（`YYYY-MM-DD`、両端含む）
- 対象カード（= 親ノードID）

### 2.2 Y / X の決定

- **Y**: 親ノードの `metricRef`（親が `metricRef` と `serviceId` を持つ場合）
- **X**: 親ノードの直下の子（子がfolderならleafまで展開したleaf群）

#### 2.2.1 親指標（Y）が未設定の場合

- 分析ボタンは **非活性**
- 表示文言: `親指標（Y）が未設定です`

### 2.3 標準化（単位合わせ）

回帰前に **z-score 標準化**を行う。

- \(z = (x - \mu) / \sigma\)
- 係数は標準化係数（比較しやすい）として表示する
- 予測値は標準化空間で予測し、表示時は **元スケールへ逆変換**して可視化する

### 2.4 データ不足のエラー条件（minObs）

- 有効観測数 \(n\) が **12未満（minObs=12）** の場合はエラー

エラーメッセージ例:
- `分析に必要なデータが不足しています（必要: 12点以上 / 現在: n点）`

> 欠損（null）を除外した後の観測数で判定する。

### 2.5 X上限（説明変数の上限）

- Xは最大 **20**
- 21以上の場合は **ツリー順（上から）で先頭20**を採用する（説明可能性優先）

### 2.6 モデル

- 初期モデルは **Ridge回帰**（過学習抑制のため）
- λ（正則化強度）は初期は固定でよい（将来的に調整UIを追加可能）

### 2.7 結果として計算・表示する指標

分析結果として以下を算出し、カード内に表示する。

- **式（標準化係数）**
  - \(z(Y) = b_0 + b_1 z(X_1) + ... + b_p z(X_p)\)
- **ビジュアル**
  - 影響度ランキング（係数の絶対値バー）
  - 予測 vs 実測（元スケール）の折れ線（ミニでOK）
- **評価指標**
  - `MAE`, `RMSE`, `MAPE`, `R²`, `n`

MAPEの注意:
- \(|y| < \epsilon\)（0近傍）は MAPE 計算から除外し、その除外数も表示する（推奨）

---

## 3. 画面ロック（timeUnit / dateRange）の仕様

### 3.1 ロック条件

- **1つでもサマリカードの分析を実行（保存）したら**、画面の `timeUnit` と `dateRange` は編集不可（ロック）とする。

### 3.2 ロック後の挙動

- ロック状態では
  - `timeUnit` / `dateRange` 入力UIを disabled
  - ロック理由を小さく表示（例: `分析結果が存在するため、集計粒度・期間は固定されています`）

> 運用上の詰まりを避けるため、将来「分析をリセット（全結果破棄）」ボタンを用意する余地を残す。

---

## 4. 「全ての分析が完了」の定義と検証ボタン

### 4.1 完了判定

「全ての分析が完了」＝ **回帰可能なカード（Yがあるカード）**が全て分析済みであること。

### 4.2 検証ボタンの活性条件

- 完了判定を満たしたら、画面上部の **検証ボタンを活性化**

---

## 5. 検証（Validation）の仕様

### 5.1 検証の目的

分析で得たモデルについて、指定した検証期間における

- **予測値（predicted）**
- **実測値（actual）**
- **残差（residual = actual - predicted）**

を算出し、ズレ（誤差）を評価する。

### 5.2 検証ボタン押下時のUI

- モーダルを表示し、以下を入力できるようにする
  - `validationStart`〜`validationEnd`（`YYYY-MM-DD`、両端含む）
  - `AI分析を有効化` チェックボックス（後述）

### 5.3 検証の実行タイミング

検証期間保存時に以下で分岐する。

- `validationEnd <= 今日` の場合
  - **即時評価**して `completed`
- `validationEnd > 今日` の場合
  - `pending` として保存（終了日以降にバッチ等で評価）

### 5.4 検証で出すズレ（サマリ単位＋全体）

- **サマリ単位（カード単位）**
  - 各カードで predicted/actual/residual を出し、誤差指標（MAE/RMSE/MAPE等）を算出
- **全体**
  - カード単位の誤差指標を集約して、全体スコアを算出
  - 例: 全体MAPE = 平均（カードMAPE）、併せて中央値も推奨

---

## 6. AI評価（検証オプション）

### 6.1 目的

検証結果（残差の特徴や、悪化している期間・要因候補）をもとに、AIが

- モデルの妥当性
- 改善提案
- 注意点

などを文章で出力し、運用者が理解しやすくする。

### 6.2 実行条件

- 検証モーダルの `AI分析を有効化` がONの場合のみ実行する

### 6.3 実行タイミング

- 検証評価（残差算出）完了後に実行（同時でも直後でも可）
- AI評価が失敗しても、検証そのものは成功扱いにできる設計が望ましい

---

## 7. API設計（案）

実装の都合に合わせてパスは調整可能だが、責務は以下で分離する。

### 7.1 カード分析の実行（カード単位）

- `POST /api/projects/[projectId]/summary-cards/analysis/run`

Request:

```json
{
  "treeId": "uuid",
  "parentNodeId": "uuid",
  "timeUnit": "day",
  "rangeStart": "2026-04-01",
  "rangeEnd": "2026-04-14"
}
```

Response（例）:

```json
{
  "success": true,
  "data": {
    "parentNodeId": "uuid",
    "timeUnit": "day",
    "rangeStart": "2026-04-01",
    "rangeEnd": "2026-04-14",
    "standardized": true,
    "model": {
      "type": "ridge",
      "lambda": 1.0,
      "intercept": 0.12,
      "coefficients": [
        { "ref": "serviceId::metricRef", "coef": 0.31 }
      ]
    },
    "metrics": { "r2": 0.72, "mae": 123, "rmse": 180, "mape": 4.2, "n": 14 },
    "series": [
      { "period": "4/1", "actual": 1000, "predicted": 980, "residual": 20 }
    ]
  }
}
```

### 7.2 分析結果の取得（保存済み）

- `GET /api/projects/[projectId]/summary-cards/analysis?treeId=...&timeUnit=...&rangeStart=...&rangeEnd=...`

### 7.3 検証期間の作成

- `POST /api/projects/[projectId]/summary-cards/validation-periods`

### 7.4 検証の評価実行（pending→completed）

- `POST /api/projects/[projectId]/summary-cards/validation-periods/[id]/evaluate`

---

## 8. DB設計（案）

既存 `kpi_validation_periods` に寄せるか、新規テーブルを切るかは実装時に決定する。

## 10. KPIツリーの「型（テンプレ）」運用（全クライアント共通）

KPIツリーの型は、クライアント/プロジェクトに紐づけず **グローバルテンプレ**としてDBに保存する。

- マイグレーション: `supabase/migrations/035_kpi_tree_templates.sql`
- テンプレは service_role によるSQL投入で追加し、ログインユーザーは参照のみ可能
- プロジェクトへは「適用（複製）」により `kpi_trees` / `project_kpi_tree_nodes` を作成する（適用機能は別途実装）

### 8.1 分析結果（カード単位）

例: `summary_card_analysis_results`

- `project_id`
- `kpi_tree_id`
- `parent_node_id`
- `time_unit`
- `range_start`, `range_end`
- `y_ref`（serviceId/metricRef）
- `x_refs[]`（最大20）
- `model_json`（係数・切片・lambda・標準化情報）
- `metrics_json`（r2/mae/rmse/mape/n）
- `series_json`（actual/predicted/residual の時系列）
- `created_at`, `updated_at`

### 8.2 ロック状態（分析セッション）

例: `summary_card_analysis_sessions`

- `project_id`
- `kpi_tree_id`
- `time_unit`
- `range_start`, `range_end`
- `status`: `draft | locked | completed`
- `created_at`

---

## 9. 受け入れ基準（チェックリスト）

- [ ] Y未設定カードの分析ボタンが非活性で、理由が表示される
- [ ] 分析ボタン押下で回帰が実行され、式・影響度バー・予測vs実測が表示される
- [ ] minObs=12 未満はエラーで分かりやすいメッセージが出る
- [ ] Xが20を超える場合、ツリー順で上から20が使われる
- [ ] 1件でも分析実行で timeUnit/dateRange がロックされる
- [ ] 回帰可能カードが全て分析済みになると検証ボタンが活性化する
- [ ] 検証期間を入れて、validationEnd が過去なら即時に検証結果が出る
- [ ] validationEnd が未来なら pending になり、evaluate で completed になる
- [ ] 全体スコアがカードスコアの集約として表示される
- [ ] AI分析ONでAI評価が保存される（失敗しても検証結果は残る）


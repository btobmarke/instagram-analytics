# プロジェクト横断サマリー＆分析 — 実装計画書

> 作成日: 2026-04-13  
> 対象リポジトリ: instagram-analytics_repo  
> 実装担当: Cursor（本書を入力として使用）

---

## 目次

1. [概要・方針](#1-概要方針)
2. [既存コードの前提と制約](#2-既存コードの前提と制約)
3. [DBスキーマ設計](#3-dbスキーマ設計)
4. [APIルート設計](#4-apiルート設計)
5. [集計バッチ設計](#5-集計バッチ設計)
6. [外生変数（祝日・天気）設計](#6-外生変数祝日天気設計)
7. [フロントエンド設計](#7-フロントエンド設計)
8. [実装フェーズ・順序](#8-実装フェーズ順序)
9. [Cursor 用プロンプト集](#9-cursor-用プロンプト集)

---

## 1. 概要・方針

### ゴール

プロジェクト配下の**全アクティブサービス**を横断した、チャネル統合サマリーを提供する。

- **レポートタブ**：人が読む用。KPI サマリーカード＋主要チャート。
- **データ表タブ**：分析用ワイド表（日付×全指標）。CSV エクスポート任意。

### 設計方針

| 項目 | 方針 |
|---|---|
| スコープ | `deleted_at IS NULL` のアクティブサービスを自動包含 |
| 指標ソース | 各サービスのカタログ（`getMetricCatalog(serviceType)`）を自動使用 |
| 実装アーキテクチャ | **Phase A**: クエリ時並列取得（新DB不要・即出荷可能）→ **Phase B**: `project_metrics_daily` マテリアライズ化（パフォーマンス最適化） |
| 外生変数 | 祝日：`date-holidays` ライブラリ、天気：Open-Meteo（APIキー不要） |
| 初回スコープ | 社内利用のみ。権限・免責は次期フェーズ。 |
| UI ルート | `/projects/[projectId]/unified-summary` |

---

## 2. 既存コードの前提と制約

### 参照すべき既存ファイル

| ファイル | 役割 |
|---|---|
| `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/types.ts` | `MetricCard`, `FormulaNode`, `SummaryTemplate`, `TimeUnit` の型定義 |
| `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog.ts` | `getMetricCatalog(serviceType)` → `MetricCard[]` |
| `src/app/api/services/[serviceId]/summary/data/route.ts` | 既存のサービス別指標取得ロジック（テーブルごとのフェッチ関数群） |
| `src/lib/summary/jst-periods.ts` | `generateJstDayPeriods`, `generateCustomRangePeriod` |

### 指標の ID 体系（MetricCard）

```
id = "テーブル名.フィールド名"
例: "ig_account_insight_fact.reach"
    "gbp_performance_daily.call_clicks"
    "line_oam_friends_daily.contacts"
    "metric_summaries.session_count"
```

### 現状のサービス種別と対応カタログ

| service_type | getMetricCatalog が返すカテゴリ |
|---|---|
| `instagram` | アカウントインサイト / フィード投稿 / リール投稿 / ストーリーズ |
| `gbp` | パフォーマンス / クチコミ |
| `line` | 友だち数 / 友だち属性 / ショップカード / ポイント分布 / トランザクション |
| `lp` | KPI集計 / セッション / ページビュー / イベント / ユーザー |
| `google_ads` | ※後続実装。カタログ追加時は `catalog.ts` と本設計を同時更新 |

---

## 3. DBスキーマ設計

### Phase A では新規 DB テーブル不要

Phase A（クエリ時取得）は既存テーブルのみ使用。以下の新規テーブルは Phase B 以降で追加する。

### Phase B 以降: `supabase/migrations/019_unified_summary.sql`

```sql
-- Migration 019: プロジェクト横断サマリー基盤
--
-- Phase A完了後、パフォーマンスが問題になった場合に適用。
-- project_metrics_daily : プロジェクト×サービス×日次の集計済みキャッシュ（EAV形式）
-- project_external_daily: 祝日・天気などの外生変数（プロジェクト単位）

-- ─────────────────────────────────────────────────────────────
-- 1. プロジェクト日次指標キャッシュ（EAV形式）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_metrics_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  metric_ref   TEXT NOT NULL,   -- "table.field" 形式 (例: ig_account_insight_fact.reach)
  value        NUMERIC,         -- NULL = データなし
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, service_id, date, metric_ref)
);

CREATE INDEX idx_project_metrics_daily_project_date
  ON project_metrics_daily (project_id, date DESC);

CREATE INDEX idx_project_metrics_daily_service_date
  ON project_metrics_daily (service_id, date DESC);

ALTER TABLE project_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON project_metrics_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON project_metrics_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. プロジェクト外生変数（祝日・天気）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_external_daily (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  is_holiday        BOOLEAN,                -- 祝日フラグ（日本）
  holiday_name      TEXT,                   -- 祝日名
  temperature_max   NUMERIC(5,1),           -- 最高気温（℃）
  temperature_min   NUMERIC(5,1),           -- 最低気温（℃）
  precipitation_mm  NUMERIC(6,1),           -- 降水量（mm）
  weather_code      INTEGER,                -- WMO天気コード（Open-Meteo準拠）
  weather_desc      TEXT,                   -- 天気説明（晴れ/曇り/雨 など）
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, date)
);

ALTER TABLE project_external_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON project_external_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON project_external_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. プロジェクトに位置情報を追加（Open-Meteo の天気取得用）
--    projects テーブルへのカラム追加
-- ─────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude   NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS location_name TEXT;    -- 例: "東京都渋谷区"
```

---

## 4. APIルート設計

### 新規 API 一覧

```
GET  /api/projects/[projectId]/unified-summary
     → 全サービスの指標データをクロス集計して返す（Phase A: クエリ時取得）

GET  /api/projects/[projectId]/unified-summary/config
     → プロジェクトのサービス一覧・利用可能指標一覧を返す

GET  /api/projects/[projectId]/unified-summary/external
     → 祝日・天気外生変数を返す（Phase B以降）

PUT  /api/projects/[projectId]/location
     → プロジェクトに lat/lng を登録（天気取得用）
```

### `GET /api/projects/[projectId]/unified-summary`

**Request**
```
Query params:
  timeUnit    day | week | month | custom_range (default: day)
  count       期間数 (default: 8, max: 90)
  rangeStart  YYYY-MM-DD（custom_range 時必須）
  rangeEnd    YYYY-MM-DD（custom_range 時必須）
  services    カンマ区切りのserviceId（省略時は全アクティブサービス）
```

**Response**
```typescript
{
  success: true,
  data: {
    periods: string[],           // 時間軸ラベル ["4/6", "4/7", ...]
    services: {
      id: string,
      name: string,
      serviceType: string,
      metrics: {
        [metricRef: string]: {   // "ig_account_insight_fact.reach" など
          label: string,         // "リーチ"
          category: string,      // "アカウントインサイト"
          values: Record<string, number | null>  // { "4/6": 1200, "4/7": null }
        }
      }
    }[]
  }
}
```

**実装方針（Phase A）**

```typescript
// src/app/api/projects/[projectId]/unified-summary/route.ts

export async function GET(req, { params }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  // 1. 認証チェック
  // 2. アクティブサービス一覧取得（deleted_at IS NULL）
  const { data: services } = await supabase
    .from('services')
    .select('id, service_name, service_type')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at')

  // 3. 各サービスのカタログを取得
  // 4. 既存 summary/data ルートの fetchXxx 関数群を再利用して並列クエリ
  // 5. サービス別・指標別のデータをまとめてレスポンス
}
```

**重要**: 既存の `src/app/api/services/[serviceId]/summary/data/route.ts` の各 `fetchXxx` 関数を `src/lib/summary/fetch-metrics.ts` に切り出し、`/summary/data` と `/unified-summary` の両方から import できるようにリファクタリングする。

### `GET /api/projects/[projectId]/unified-summary/config`

プロジェクト内のサービスと、各サービスで利用可能な指標の一覧を返す。フロントエンドの初期化で使用。

```typescript
{
  success: true,
  data: {
    services: {
      id: string,
      name: string,
      serviceType: string,
      availableMetrics: MetricCard[]   // getMetricCatalog(serviceType) の結果
    }[]
  }
}
```

---

## 5. 集計バッチ設計（Phase B以降）

Phase A のクエリ時取得で問題なければスキップ可能。

### ファイル

`src/app/api/batch/project-metrics-aggregate/route.ts`

### バッチフロー

```
1. 全プロジェクトを取得（または特定プロジェクトを引数で受け取り）
2. 各プロジェクトのアクティブサービスを取得
3. 各サービスの昨日分データを existing fetch関数で取得
4. project_metrics_daily に UPSERT（metric_ref 単位）
5. batch_job_logs に記録（job_name: 'project_metrics_aggregate'）
```

### Vercel Cron

```json
{ "path": "/api/batch/project-metrics-aggregate", "schedule": "30 2 * * *" }
```

（JST 11:30 = UTC 02:30、各サービスの日次バッチ完了後に実行）

---

## 6. 外生変数（祝日・天気）設計

### 祝日

ライブラリを使用（APIコストゼロ）：

```bash
npm install date-holidays
```

```typescript
// src/lib/external/holidays.ts
import Holidays from 'date-holidays'

const hd = new Holidays('JP')

export function isHoliday(date: string): { isHoliday: boolean; name?: string } {
  const result = hd.isHoliday(new Date(date))
  if (!result) return { isHoliday: false }
  return { isHoliday: true, name: Array.isArray(result) ? result[0].name : result.name }
}
```

### 天気（Open-Meteo）

APIキー不要・非商用向け（利用規約要確認）。

```typescript
// src/lib/external/weather.ts

/**
 * Open-Meteo の History API で指定日の天気を取得
 * https://open-meteo.com/en/docs/historical-weather-api
 *
 * 注意: 非商用利用向け。商用利用の場合は有料プランを検討すること。
 *       バッチで1日1回・プロジェクト単位でリクエストし、DB にキャッシュする。
 */
export async function fetchWeather(params: {
  latitude: number
  longitude: number
  date: string  // YYYY-MM-DD
}): Promise<{
  temperature_max: number | null
  temperature_min: number | null
  precipitation_mm: number | null
  weather_code: number | null
  weather_desc: string | null
}> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive')
  url.searchParams.set('latitude',     String(params.latitude))
  url.searchParams.set('longitude',    String(params.longitude))
  url.searchParams.set('start_date',   params.date)
  url.searchParams.set('end_date',     params.date)
  url.searchParams.set('daily',        'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code')
  url.searchParams.set('timezone',     'Asia/Tokyo')

  const res = await fetch(url.toString())
  if (!res.ok) return { temperature_max: null, temperature_min: null, precipitation_mm: null, weather_code: null, weather_desc: null }

  const json = await res.json()
  const daily = json.daily
  if (!daily) return { temperature_max: null, temperature_min: null, precipitation_mm: null, weather_code: null, weather_desc: null }

  const wc = daily.weather_code?.[0] ?? null
  return {
    temperature_max:  daily.temperature_2m_max?.[0] ?? null,
    temperature_min:  daily.temperature_2m_min?.[0] ?? null,
    precipitation_mm: daily.precipitation_sum?.[0] ?? null,
    weather_code:     wc,
    weather_desc:     wc != null ? wmoCodeToDesc(wc) : null,
  }
}

/** WMO天気コード → 日本語説明 */
function wmoCodeToDesc(code: number): string {
  if (code === 0)             return '快晴'
  if (code <= 3)              return '晴れ〜曇り'
  if (code <= 9)              return '曇り'
  if (code <= 19)             return '霧・霞'
  if (code <= 29)             return '降水（前時間）'
  if (code <= 39)             return '砂嵐'
  if (code <= 49)             return '霧'
  if (code <= 59)             return '霧雨'
  if (code <= 69)             return '雨'
  if (code <= 79)             return '雪'
  if (code <= 84)             return 'にわか雨'
  if (code <= 94)             return '雷雨'
  return '強雷雨'
}
```

### 外生変数バッチ

`src/app/api/batch/external-data/route.ts`

```
1. 全プロジェクト（latitude/longitude 設定済みのもの）を取得
2. 昨日の祝日フラグを isHoliday() で計算
3. latitude/longitude が設定されていれば fetchWeather() で天気取得
4. project_external_daily に UPSERT
5. batch_job_logs に記録（job_name: 'external_data'）
```

---

## 7. フロントエンド設計

### ルート

```
src/app/(dashboard)/projects/[projectId]/unified-summary/page.tsx
```

プロジェクトページ（`/projects/[projectId]/page.tsx`）に「横断サマリー」リンクを追加。

### ページ構成

```
<UnifiedSummaryPage>
  ├── <PageHeader>
  │   ├── タイトル: "横断サマリー"
  │   ├── <TimeUnitSelector />   ← 日/週/月/期間指定
  │   └── <ServiceFilter />      ← サービス絞り込み（全選択デフォルト）
  │
  └── <Tabs defaultTab="report">
      ├── [レポート]タブ
      │   └── <ReportView />
      └── [データ表]タブ
          └── <DataTableView />
```

### レポートタブ（`<ReportView>`）

```
<ReportView>
  ├── <ServiceSummaryCards>        ← サービスごとのKPIカード（上位指標のみ）
  │   ├── <InstagramCard />        ← リーチ・フォロワー・エンゲージメント
  │   ├── <GbpCard />             ← 検索表示・電話クリック・ルート検索
  │   ├── <LineCard />            ← 友だち数・ターゲットリーチ
  │   ├── <LpCard />              ← セッション数・ユーザー数・HOTセッション率
  │   └── <GoogleAdsCard />       ← インプレッション・クリック・費用・ROAS（将来）
  │
  └── <TrendCharts>               ← チャネル横断トレンドグラフ
      ├── 指標セレクター（各サービスの指標から最大5つ選択）
      └── 折れ線グラフ（Recharts LineChart）
```

**各サービスカードのデフォルト表示指標**

| サービス | カード表示指標（最大4つ） |
|---|---|
| Instagram | フォロワー数・リーチ・いいね数・エンゲージしたアカウント数 |
| GBP | モバイル検索表示・電話クリック数・ウェブサイトクリック数・ルート検索数 |
| LINE | 友だち数・ターゲットリーチ数・ブロック数 |
| LP | セッション数・ユーザー数・HOTセッション率・平均滞在時間 |
| Google Ads | インプレッション・クリック・費用・ROAS |

### データ表タブ（`<DataTableView>`）

ワイド表（行 = 時間軸ラベル、列 = サービス×指標）

```
| 期間    | [IG] フォロワー数 | [IG] リーチ | [GBP] 電話クリック | [LINE] 友だち数 | ... |
|---------|----------------|------------|------------------|---------------|-----|
| 4/6(日) | 1,204           | 8,432      | 23               | 1,580         | ... |
| 4/7(月) | 1,210           | 9,105      | 31               | 1,582         | ... |
| 4/8(火) | -               | -          | 28               | 1,585         | ... |
```

**列ヘッダー形式**: `[サービス略称] 指標名`

```typescript
// 列定義
interface WideTableColumn {
  key: string          // "svc-uuid.ig_account_insight_fact.reach"
  serviceId: string
  serviceName: string
  serviceType: string
  metricRef: string    // "ig_account_insight_fact.reach"
  label: string        // "リーチ"
  category: string
}
```

**指標フィルタリング UI**

- 列が多すぎる場合のために「表示指標の選択」モーダルを用意
- デフォルト：各サービスのカタログ全指標を表示（数十列になる可能性あり）
- 列グループを `category` 単位で折りたたみ可能にすることを推奨

### 外生変数の表示（Phase B以降）

データ表に追加列として組み込む：

```
| 期間    | 祝日 | 天気 | 最高気温 | 降水量 | [IG] フォロワー数 | ...
|---------|-----|------|---------|-------|----------------|
| 4/6(日) | -   | 晴れ  | 18.2℃  | 0mm  | 1,204           |
| 4/7(月) | -   | 雨   | 14.5℃  | 12mm | 1,210           |
| 4/29(火)| 昭和の日 | 曇り | 20.1℃ | 0mm | 1,350          |
```

### プロジェクト一覧ページへのナビゲーション追加

`src/app/(dashboard)/projects/[projectId]/page.tsx` のプロジェクトヘッダー部分に「横断サマリーを見る」ボタンを追加：

```typescript
<Link href={`/projects/${projectId}/unified-summary`}>
  横断サマリーを見る
</Link>
```

---

## 8. 実装フェーズ・順序

### Phase A — コア実装（最優先）

**目標**: 横断サマリーを動く状態で出荷する。

1. **リファクタリング（必須）**
   - `src/app/api/services/[serviceId]/summary/data/route.ts` の各 `fetchXxx` 関数を `src/lib/summary/fetch-metrics.ts` に切り出す
   - `/summary/data/route.ts` は `fetch-metrics.ts` を import して使うように変更（動作は変えない）
   
2. **APIルート実装**
   - `src/app/api/projects/[projectId]/unified-summary/route.ts`（GET）
   - `src/app/api/projects/[projectId]/unified-summary/config/route.ts`（GET）
   
3. **フロントエンド実装**
   - `src/app/(dashboard)/projects/[projectId]/unified-summary/page.tsx`
   - レポートタブ（サービスカード＋トレンドグラフ）
   - データ表タブ（ワイド表）
   - プロジェクトページへのナビゲーション追加

### Phase B — 外生変数

1. `supabase/migrations/019_unified_summary.sql` を Supabase に適用
2. `npm install date-holidays`
3. `src/lib/external/holidays.ts` 実装
4. `src/lib/external/weather.ts` 実装
5. `src/app/api/batch/external-data/route.ts` 実装
6. プロジェクト設定画面に `latitude/longitude` 入力を追加
7. データ表に祝日・天気列を追加

### Phase C — マテリアライズ化（パフォーマンス改善）

Phase A 出荷後、レスポンスが遅い場合に実施。

1. `project_metrics_daily` テーブルを適用（Migration 019）
2. `src/app/api/batch/project-metrics-aggregate/route.ts` 実装
3. `vercel.json` にCronを追加
4. Unified summary API を `project_metrics_daily` キャッシュから読むように切り替え

### Phase D — KPI ツリー・分析（後続）

- KPIツリー（Drag & Drop）保存テーブル、枝→Y変数プリセット
- 相関・回帰MVP
- 権限・免責文言

---

## 9. Cursor 用プロンプト集

### 9-1. fetch-metrics.ts への切り出し（Phase A 最初）

```
src/app/api/services/[serviceId]/summary/data/route.ts にある以下の関数を
src/lib/summary/fetch-metrics.ts に切り出してください。

切り出す関数:
- fetchIgAccountInsight
- fetchIgMediaInsightByProduct
- fetchGbpPerformance
- fetchLineFriendsDaily
- fetchLineRewardcardTable
- fetchMetricSummaries
- fetchLpTable
- 内部で使われる型: Period, emptyAccum, finalizeAccum, addValue, bucketDate, AVG_FIELDS

切り出し後、data/route.ts は fetch-metrics.ts から import して使うように変更してください
（動作は一切変えないこと）。

新しい fetch-metrics.ts のシグネチャ例:
  export type { Period }
  export { fetchIgAccountInsight, fetchGbpPerformance, ... }

切り出した関数が受け取る supabase クライアントの型:
  Awaited<ReturnType<typeof createSupabaseServerClient>>
```

### 9-2. unified-summary config API

```
以下の API ルートを新規作成してください。

ファイル: src/app/api/projects/[projectId]/unified-summary/config/route.ts

GET /api/projects/[projectId]/unified-summary/config

処理:
1. 認証チェック（createSupabaseServerClient）
2. projects テーブルで projectId が存在するか確認
3. services テーブルから project_id = projectId かつ deleted_at IS NULL のレコードを
   id, service_name, service_type で取得
4. 各サービスについて getMetricCatalog(service_type) を呼ぶ
   （src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog.ts から import）
5. レスポンス形式:
   {
     success: true,
     data: {
       services: {
         id: string,
         name: string,      // service_name
         serviceType: string,
         availableMetrics: MetricCard[]
       }[]
     }
   }
```

### 9-3. unified-summary データ API

```
以下の API ルートを新規作成してください。

ファイル: src/app/api/projects/[projectId]/unified-summary/route.ts

GET /api/projects/[projectId]/unified-summary

Query params:
  timeUnit    day | week | month | custom_range (default: day)
  count       1〜90 (default: 8)
  rangeStart  YYYY-MM-DD（custom_range 時必須）
  rangeEnd    YYYY-MM-DD（custom_range 時必須）

処理:
1. 認証チェック
2. アクティブサービス一覧取得（deleted_at IS NULL）
3. 期間生成（generateJstDayPeriods or 他 — src/lib/summary/jst-periods.ts を使用）
4. 各サービスについて getMetricCatalog(serviceType) でカード一覧取得
5. fetch-metrics.ts の各 fetchXxx 関数を並列実行（Promise.all）
   - テーブル名でルーティング（既存 data/route.ts の switch 文と同じロジック）
6. レスポンス形式（UNIFIED_SUMMARY_IMPL_PLAN.md §4 参照）:
   {
     success: true,
     data: {
       periods: string[],
       services: {
         id, name, serviceType,
         metrics: {
           [metricRef]: { label, category, values: Record<string, number | null> }
         }
       }[]
     }
   }

注意: fetch-metrics.ts の関数を使うこと（data/route.ts から直接コピーしない）
```

### 9-4. フロントエンド: unified-summary ページ

```
以下のページを新規作成してください。

ファイル: src/app/(dashboard)/projects/[projectId]/unified-summary/page.tsx

要件:
1. useSWR で GET /api/projects/${projectId}/unified-summary/config を取得（サービス一覧）
2. useSWR で GET /api/projects/${projectId}/unified-summary?timeUnit=...&count=... を取得（データ）
3. タブ「レポート」と「データ表」を用意（既存の Tabs コンポーネントがあれば流用）

[レポートタブ]
- 各サービスごとに KPI カードを表示
- カードに表示する指標は UNIFIED_SUMMARY_IMPL_PLAN.md §7 のデフォルト指標を使用
- データがない指標は "—" 表示
- 最新期間の値と前期間比（％増減）を表示

[データ表タブ]
- ワイド表を表示（UNIFIED_SUMMARY_IMPL_PLAN.md §7 参照）
- 行 = 期間ラベル、列 = [サービス名] 指標名
- 期間・粒度は TimeUnitSelector コンポーネントで切り替え可能

タイムライン選択:
- 「日」「週」「月」のトグルボタン
- count は日=30、週=12、月=12 をデフォルト

styled は既存ページのデザインに合わせること（Tailwind CSS）
params は use(params) で解決すること（Next.js App Router の async params）
```

### 9-5. プロジェクトページへのリンク追加

```
src/app/(dashboard)/projects/[projectId]/page.tsx を修正してください。

プロジェクトヘッダー（プロジェクト名が表示されている付近）に
「横断サマリーを見る」ボタン/リンクを追加してください。

リンク先: /projects/${projectId}/unified-summary

デザインは既存の「サービスを追加」などのボタンに合わせてください。
```

### 9-6. 外生変数バッチ（Phase B）

```
以下の2ファイルを新規作成してください。

1. src/lib/external/holidays.ts
   - npm install date-holidays を前提
   - isHoliday(date: string): { isHoliday: boolean; name?: string }
   - 日本（JP）の祝日判定
   UNIFIED_SUMMARY_IMPL_PLAN.md §6 のコード例を参考にしてください。

2. src/lib/external/weather.ts
   - fetchWeather(params: { latitude, longitude, date }): Promise<WeatherData>
   - Open-Meteo archive API を使用（APIキー不要）
   - UNIFIED_SUMMARY_IMPL_PLAN.md §6 のコード例を参考にしてください。

3. src/app/api/batch/external-data/route.ts
   - GET / POST 両対応（Vercel Cron 用）
   - CRON_SECRET 認証
   - project_external_daily に UPSERT（昨日分）
   - latitude/longitude が NULL のプロジェクトは天気取得をスキップ
   - batch_job_logs に job_name='external_data' で記録
   - maxDuration = 60
```

---

## 付録: データ表 列ヘッダー生成ロジック

```typescript
// サービス略称マップ
const SERVICE_TYPE_ABBR: Record<string, string> = {
  instagram:  'IG',
  gbp:        'GBP',
  line:       'LINE',
  lp:         'LP',
  ga4:        'GA4',
  clarity:    'Clarity',
  google_ads: 'GAds',
}

// 列キー生成
const colKey = (serviceId: string, metricRef: string) =>
  `${serviceId}.${metricRef}`

// 列ヘッダーラベル生成
const colHeader = (serviceType: string, metricLabel: string) =>
  `[${SERVICE_TYPE_ABBR[serviceType] ?? serviceType}] ${metricLabel}`
```

## 付録: Open-Meteo 利用上の注意

- **利用規約**: 非商用・研究目的向けの無料利用条件あり。商用利用は有料プランが必要な場合があります。実装前に https://open-meteo.com/en/terms を確認してください。
- **リクエスト数**: バッチ1日1回・プロジェクト単位のリクエストに留めること。店舗数×日数でコール数が増加するため、必ず `project_external_daily` にキャッシュして再利用すること。
- **過去データ**: Archive API（`archive-api.open-meteo.com`）は過去5日以上前のデータのみ取得可能。当日・翌日は Forecast API を使う必要あり。
- **代替**: 商用利用が確定した場合は OpenWeather API（月額プランあり）への切り替えを検討してください。

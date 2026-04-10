# Google 広告 サービス実装計画書

> 作成日: 2026-04-09  
> 対象リポジトリ: instagram-analytics_repo  
> 実装担当: Cursor（本書を入力として使用）

---

## 目次

1. [概要・方針](#1-概要方針)
2. [DBスキーマ設計（マイグレーション SQL）](#2-dbスキーマ設計マイグレーション-sql)
3. [環境変数](#3-環境変数)
4. [認証フロー（OAuth 2.0）](#4-認証フローoauth-20)
5. [APIルート設計](#5-apiルート設計)
6. [バッチ設計](#6-バッチ設計)
7. [フロントエンド設計](#7-フロントエンド設計)
8. [AI分析設計](#8-ai分析設計)
9. [実装フェーズ・順序](#9-実装フェーズ順序)
10. [Cursor 用プロンプト集](#10-cursor-用プロンプト集)

---

## 1. 概要・方針

### サービス概要

- Google 広告データを1日1回バッチで取得・保存し、ダッシュボード・サマリー・AI分析を提供する
- 既存の GBP・LINE・Instagram と同じ画面構成（ダッシュボード / サマリー / 設定）を採用
- サマリー機能は既存の `summary_templates` 基盤をそのまま流用
- AI分析は Instagram と同じ3フェーズ構成（週次レポート → 単体分析 → チャット）

### アーキテクチャ方針

| 項目 | 方針 |
|---|---|
| MCC（管理アカウント） | クライアント単位で1つ保持（GBP の `client_gbp_credentials` と同設計） |
| Developer Token | システム環境変数 `GOOGLE_ADS_DEVELOPER_TOKEN` のみ（クライアント登録不要） |
| OAuth フロー | GBP と同様。POST credential → GET auth（リダイレクト）→ callback で refresh_token 保存 |
| データ粒度 | キャンペーン日次 + 広告グループ日次 + キーワード日次（キーワードはプロジェクト単位 toggle） |
| service_type 値 | `'google_ads'` |

---

## 2. DBスキーマ設計（マイグレーション SQL）

### ファイル名

`supabase/migrations/018_google_ads.sql`

```sql
-- Migration 018: Google 広告サービス
--
-- 設計方針:
--   - client_google_ads_credentials : クライアント単位のOAuth認証情報（MCC経由管理）
--   - google_ads_service_configs    : サービス（広告アカウント）設定
--   - google_ads_campaigns          : キャンペーンマスタ
--   - google_ads_ad_groups          : 広告グループマスタ
--   - google_ads_keywords           : キーワードマスタ
--   - google_ads_campaign_daily     : キャンペーン日次指標
--   - google_ads_adgroup_daily      : 広告グループ日次指標
--   - google_ads_keyword_daily      : キーワード日次指標
--   - google_ads_batch_runs         : バッチ実行ログ

-- ─────────────────────────────────────────────────────────────
-- 1. クライアント単位 Google Ads 認証情報
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_google_ads_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  oauth_client_id_enc   TEXT NOT NULL,          -- OAuth クライアントID（暗号化）
  oauth_client_secret_enc TEXT NOT NULL,        -- OAuth クライアントシークレット（暗号化）
  refresh_token_enc     TEXT,                   -- リフレッシュトークン（暗号化）。OAuth完了後に保存
  manager_customer_id   TEXT NOT NULL,          -- MCC の顧客ID（ハイフンなし10桁）
  google_account_email  TEXT,                   -- 認証したGoogleアカウントのメール
  auth_status           TEXT NOT NULL DEFAULT 'pending'
                          CHECK (auth_status IN ('pending', 'active', 'error')),
  scopes                TEXT[],
  last_verified_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_client_google_ads_credentials_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_client_google_ads_credentials_updated_at
  BEFORE UPDATE ON client_google_ads_credentials
  FOR EACH ROW EXECUTE FUNCTION trg_client_google_ads_credentials_updated_at();

ALTER TABLE client_google_ads_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON client_google_ads_credentials
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON client_google_ads_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. サービス（広告アカウント）設定
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_service_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  customer_id       TEXT NOT NULL,              -- 広告アカウントの顧客ID（ハイフンなし10桁）
  account_name      TEXT,
  currency_code     TEXT DEFAULT 'JPY',
  time_zone         TEXT DEFAULT 'Asia/Tokyo',
  collect_keywords  BOOLEAN NOT NULL DEFAULT false,  -- キーワード単位収集 ON/OFF
  backfill_days     INTEGER NOT NULL DEFAULT 30,      -- 初回登録時の遡り日数（最大90）
  is_active         BOOLEAN NOT NULL DEFAULT true,
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_google_ads_service_configs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_google_ads_service_configs_updated_at
  BEFORE UPDATE ON google_ads_service_configs
  FOR EACH ROW EXECUTE FUNCTION trg_google_ads_service_configs_updated_at();

ALTER TABLE google_ads_service_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_service_configs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_service_configs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. キャンペーンマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id           TEXT NOT NULL,
  campaign_name         TEXT NOT NULL,
  status                TEXT,                   -- ENABLED / PAUSED / REMOVED
  campaign_type         TEXT,                   -- SEARCH / DISPLAY / SHOPPING など
  budget_amount_micros  BIGINT,                 -- 日予算（マイクロ単位）
  bidding_strategy      TEXT,                   -- TARGET_CPA / MAXIMIZE_CLICKS など
  start_date            DATE,
  end_date              DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, campaign_id)
);

ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_campaigns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. 広告グループマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_ad_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  ad_group_name   TEXT NOT NULL,
  status          TEXT,
  cpc_bid_micros  BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, ad_group_id)
);

ALTER TABLE google_ads_ad_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_ad_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_ad_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 5. キーワードマスタ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_keywords (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  keyword_id      TEXT NOT NULL,
  keyword_text    TEXT NOT NULL,
  match_type      TEXT,                         -- EXACT / PHRASE / BROAD
  status          TEXT,
  quality_score   INTEGER,                      -- 1〜10（利用可能な場合のみ）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, keyword_id)
);

ALTER TABLE google_ads_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_keywords
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_keywords
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 6. キャンペーン日次指標
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_campaign_daily (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,   -- 費用（マイクロ単位）
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,   -- コンバージョン金額（マイクロ）
  ctr                      NUMERIC(8,6),                -- クリック率（小数）
  average_cpc_micros       BIGINT,                      -- 平均CPC（マイクロ）
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, campaign_id, date)
);

CREATE INDEX idx_google_ads_campaign_daily_service_date
  ON google_ads_campaign_daily (service_id, date DESC);

ALTER TABLE google_ads_campaign_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_campaign_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_campaign_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 7. 広告グループ日次指標
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_adgroup_daily (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  ad_group_id              TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,
  ctr                      NUMERIC(8,6),
  average_cpc_micros       BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, ad_group_id, date)
);

CREATE INDEX idx_google_ads_adgroup_daily_service_date
  ON google_ads_adgroup_daily (service_id, date DESC);

ALTER TABLE google_ads_adgroup_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_adgroup_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_adgroup_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 8. キーワード日次指標（collect_keywords=true のサービスのみ保存）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_keyword_daily (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id               UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  campaign_id              TEXT NOT NULL,
  ad_group_id              TEXT NOT NULL,
  keyword_id               TEXT NOT NULL,
  date                     DATE NOT NULL,
  impressions              BIGINT NOT NULL DEFAULT 0,
  clicks                   BIGINT NOT NULL DEFAULT 0,
  cost_micros              BIGINT NOT NULL DEFAULT 0,
  conversions              NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion_value_micros  BIGINT NOT NULL DEFAULT 0,
  ctr                      NUMERIC(8,6),
  average_cpc_micros       BIGINT,
  quality_score            INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, keyword_id, date)
);

CREATE INDEX idx_google_ads_keyword_daily_service_date
  ON google_ads_keyword_daily (service_id, date DESC);

ALTER TABLE google_ads_keyword_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_keyword_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_keyword_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 9. バッチ実行ログ
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_batch_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       UUID REFERENCES services(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'success', 'partial', 'failed')),
  records_inserted INTEGER DEFAULT 0,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE google_ads_batch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON google_ads_batch_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON google_ads_batch_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

## 3. 環境変数

`.env.local` および Vercel 環境変数に追加：

```
# Google Ads API Developer Token（システム共通）
GOOGLE_ADS_DEVELOPER_TOKEN=xxxxxxxxxxxxxxxxxxxx

# OAuth Redirect URI（環境別に設定）
GOOGLE_ADS_REDIRECT_URI=https://<your-domain>/api/clients/google-ads/callback
```

`ENCRYPTION_KEY` は既存のものを流用（`encrypt`/`decrypt` ユーティリティ共用）。

---

## 4. 認証フロー（OAuth 2.0）

GBP の `client_gbp_credentials` / `src/app/api/clients/[clientId]/gbp/` と同設計。

### APIルート

```
POST /api/clients/[clientId]/google-ads/credential
  → client_google_ads_credentials に oauth_client_id / secret を保存
  → auth_status: 'pending'

GET  /api/clients/[clientId]/google-ads/auth
  → Google OAuth2 認証URLにリダイレクト
  → scope: https://www.googleapis.com/auth/adwords

GET  /api/clients/google-ads/callback
  → code を受け取り、refresh_token に交換
  → client_google_ads_credentials.refresh_token_enc を更新
  → auth_status: 'active'

GET  /api/clients/[clientId]/google-ads/credential
  → 認証情報の概要（トークン有無・auth_status・last_verified_at）を返す

DELETE /api/clients/[clientId]/google-ads/credential
  → 認証情報を削除（auth_status: 'pending' にリセット）
```

### アクセストークン取得ユーティリティ

`src/lib/google-ads/auth.ts`

```typescript
import { google } from 'googleapis'
import { decrypt } from '@/lib/crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function getGoogleAdsAccessToken(clientId: string): Promise<string> {
  const admin = createSupabaseAdminClient()
  const { data: cred } = await admin
    .from('client_google_ads_credentials')
    .select('oauth_client_id_enc, oauth_client_secret_enc, refresh_token_enc')
    .eq('client_id', clientId)
    .eq('auth_status', 'active')
    .single()
  if (!cred) throw new Error('Google Ads credentials not found')

  const oauth2 = new google.auth.OAuth2(
    decrypt(cred.oauth_client_id_enc),
    decrypt(cred.oauth_client_secret_enc),
  )
  oauth2.setCredentials({ refresh_token: decrypt(cred.refresh_token_enc) })
  const { token } = await oauth2.getAccessToken()
  if (!token) throw new Error('Failed to get access token')
  return token
}
```

---

## 5. APIルート設計

### クライアント設定系

```
GET    /api/clients/[clientId]/google-ads/credential  → 認証状態取得
POST   /api/clients/[clientId]/google-ads/credential  → OAuth認証情報登録
DELETE /api/clients/[clientId]/google-ads/credential  → 認証情報削除
GET    /api/clients/[clientId]/google-ads/auth        → OAuth認証URL発行（リダイレクト）
GET    /api/clients/google-ads/callback               → OAuth コールバック
```

### サービス設定系

```
GET    /api/services/[serviceId]/google-ads/config    → サービス設定取得
POST   /api/services/[serviceId]/google-ads/config    → サービス設定作成
PUT    /api/services/[serviceId]/google-ads/config    → サービス設定更新
```

### ダッシュボードデータ系

```
GET    /api/services/[serviceId]/google-ads/summary
  Query: ?start=YYYY-MM-DD&end=YYYY-MM-DD
  → キャンペーン集計（impressions/clicks/cost/conversions/ROAS）

GET    /api/services/[serviceId]/google-ads/campaigns
  → キャンペーン一覧（マスタ + 直近30日指標）

GET    /api/services/[serviceId]/google-ads/ad-groups?campaignId=xxx
  → 広告グループ一覧（マスタ + 直近30日指標）

GET    /api/services/[serviceId]/google-ads/keywords?adGroupId=xxx
  → キーワード一覧（collect_keywords=true の場合のみ有効）
```

### バッチ手動実行

```
POST   /api/batch/google-ads-daily
GET    /api/batch/google-ads-daily  （Vercel Cron 用）
```

---

## 6. バッチ設計

### ファイル

`src/app/api/batch/google-ads-daily/route.ts`

### 実行スケジュール

`vercel.json` に追加：

```json
{
  "crons": [
    { "path": "/api/batch/google-ads-daily", "schedule": "0 2 * * *" }
  ]
}
```

（JST 11:00 = UTC 02:00 に前日データ取得）

### バッチフロー

```
1. google_ads_service_configs を全件取得（is_active=true）
2. 各サービスについて：
   a. services テーブルから project_id → projects テーブルから client_id を取得
   b. client_google_ads_credentials からアクセストークン取得
   c. last_synced_at が NULL（初回）なら backfill_days 分遡る
      → 初回でなければ直近2日分のみ（昨日 + 当日分の上書き）
   d. Google Ads API（GAQL）でデータ取得（searchStream）
   e. upsert（ON CONFLICT DO UPDATE）で保存：
      - google_ads_campaign_daily
      - google_ads_adgroup_daily
      - google_ads_keyword_daily（collect_keywords=true の場合のみ）
   f. キャンペーン・広告グループ・キーワードマスタも upsert
   g. last_synced_at を更新
3. batch_job_logs に INSERT（job_name: 'google_ads_daily'）
4. 終了時に batch_job_logs を UPDATE（status/duration_ms/records_processed）
```

### GAQL クエリ例

**キャンペーン日次**
```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign_budget.amount_micros,
  campaign.bidding_strategy_type,
  campaign.start_date,
  campaign.end_date,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM campaign
WHERE segments.date BETWEEN '{startDate}' AND '{endDate}'
  AND campaign.status != 'REMOVED'
ORDER BY segments.date DESC
```

**広告グループ日次**
```sql
SELECT
  campaign.id,
  ad_group.id,
  ad_group.name,
  ad_group.status,
  ad_group.cpc_bid_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM ad_group
WHERE segments.date BETWEEN '{startDate}' AND '{endDate}'
  AND ad_group.status != 'REMOVED'
ORDER BY segments.date DESC
```

**キーワード日次**（`collect_keywords=true` のみ）
```sql
SELECT
  campaign.id,
  ad_group.id,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status,
  ad_group_criterion.quality_info.quality_score,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc,
  segments.date
FROM keyword_view
WHERE segments.date BETWEEN '{startDate}' AND '{endDate}'
  AND ad_group_criterion.status != 'REMOVED'
ORDER BY segments.date DESC
```

### Google Ads API リクエスト構造

`src/lib/google-ads/api.ts`

```typescript
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v18'

export async function searchStream(params: {
  accessToken: string
  developerToken: string
  managerCustomerId: string   // MCC の顧客ID
  customerAccountId: string  // 広告アカウントの顧客ID
  query: string
}): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `${GOOGLE_ADS_API_BASE}/customers/${params.customerAccountId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.accessToken}`,
        'developer-token': params.developerToken,
        'login-customer-id': params.managerCustomerId,  // MCC経由の場合必須
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: params.query }),
    }
  )
  // searchStream は NDJSON で返る
  const text = await res.text()
  return text
    .trim()
    .split('\n')
    .flatMap(line => {
      try {
        const parsed = JSON.parse(line)
        return parsed.results ?? []
      } catch {
        return []
      }
    })
}
```

### ROAS 計算

ROAS は取得データから算出（APIレスポンスには含まれない）：

```typescript
const roas = costMicros > 0
  ? (conversionValueMicros / costMicros)
  : null
```

`conversion_value_micros = 0` かつ `conversions > 0` の場合はコンバージョン金額未設定とみなし ROAS を null にする。

---

## 7. フロントエンド設計

### ファイル構成

```
src/app/(dashboard)/projects/[projectId]/services/[serviceId]/
  google-ads/
    analytics/
      page.tsx          ← ダッシュボード
    summary/            ← 既存サマリー基盤を流用（page.tsx + [templateId]/page.tsx）
      page.tsx
      [templateId]/
        page.tsx
    ai/
      page.tsx          ← AI分析（フェーズ2以降）
    settings/
      page.tsx          ← サービス設定（customer_id / collect_keywords / backfill_days）
```

### タブ構成

既存 Instagram / GBP / LINE と同じパターン：

```typescript
const tabs = [
  { label: 'ダッシュボード', href: `/projects/${projectId}/services/${serviceId}/google-ads/analytics` },
  { label: 'サマリー',       href: `/projects/${projectId}/services/${serviceId}/google-ads/summary` },
  { label: 'AI分析',         href: `/projects/${projectId}/services/${serviceId}/google-ads/ai` },
  { label: '設定',           href: `/projects/${projectId}/services/${serviceId}/google-ads/settings` },
]
```

### プロジェクト一覧ページ（getServiceHref 追加）

`src/app/(dashboard)/projects/[projectId]/page.tsx` の `getServiceHref` 関数に追記：

```typescript
case 'google_ads':
  return `/projects/${projectId}/services/${serviceId}/google-ads/analytics`
```

### ダッシュボードページ構成

`google-ads/analytics/page.tsx` の主要コンポーネント：

```
<GoogleAdsDashboard>
  ├── <DateRangePicker />           ← 期間選択（デフォルト: 直近30日）
  ├── <KpiCards>                    ← インプレッション / クリック / 費用 / CV数 / ROAS
  ├── <CostVsConversionChart />     ← 日次トレンドグラフ（費用 vs CV数）
  ├── <CampaignTable />             ← キャンペーン別指標一覧
  └── <AdGroupTable />              ← 広告グループ別指標一覧（キャンペーン選択時）
```

### 設定ページ構成

`google-ads/settings/page.tsx` の主要コンポーネント：

```
<GoogleAdsSettings>
  ├── <GoogleAdsConfigSection>
  │   ├── customer_id 入力
  │   ├── account_name 入力
  │   ├── currency_code / time_zone 入力
  │   ├── collect_keywords トグル（ON にすると追加費用が発生する旨の注記）
  │   └── backfill_days 入力（1〜90、デフォルト30）
  └── （サービス作成後に表示）
```

### クライアント設定ページ（InstagramTokenSection と同様）

`src/app/(dashboard)/clients/[clientId]/page.tsx` に `GoogleAdsCredentialSection` を追加：

```typescript
function GoogleAdsCredentialSection({ clientId }: { clientId: string }) {
  // GET /api/clients/${clientId}/google-ads/credential で状態取得
  // POST /api/clients/${clientId}/google-ads/credential で oauth_client_id / secret 登録
  // GET  /api/clients/${clientId}/google-ads/auth で OAuth 認証ページへ遷移
  // DELETE /api/clients/${clientId}/google-ads/credential で削除
}
```

---

## 8. AI分析設計

### 前提

- Vercel AI SDK（`ai` + `@ai-sdk/anthropic`）を使用
- Instagram の AI分析（`AI_ANALYSIS_IMPL_PLAN.md`）と同じ基盤

### フェーズ1：週次・月次レポート自動生成

**APIルート**

`src/app/api/services/[serviceId]/ai/google-ads/report/route.ts`

```typescript
export const maxDuration = 60
import { streamText } from 'ai'
import { AI_MODEL } from '@/lib/ai/config'

// POST: レポート生成（ストリーミング）
// GET:  過去レポート履歴取得
```

**プロンプト骨格（Google Ads 専用）**

```
あなたはGoogle広告の専門アナリストです。
以下の期間のデータを分析し、日本語でレポートを作成してください。

【分析期間】{period}
【キャンペーンデータ】
{campaignData}

【分析の観点】
1. 予算消化効率の評価
   - 日予算に対する実際の消化率を評価
   - 消化不足・オーバーのキャンペーンを特定
   - 予算最適化の提案

2. CTR/CPC 異常検知
   - 前週比で CTR が20%以上低下したキャンペーン・広告グループを特定
   - CPC が著しく高い/低いキャンペーンを特定
   - 異常の原因と改善策を提案

3. 全体的なパフォーマンス評価と次のアクション
```

### フェーズ2：キャンペーン・広告グループ単体 AI アドバイス

**APIルート**

`src/app/api/services/[serviceId]/ai/google-ads/advice/route.ts`

```typescript
// POST: 特定キャンペーン/広告グループの分析（ストリーミング）
// body: { type: 'campaign' | 'adgroup', targetId: string, period: string }
```

**分析の観点**

- 予算消化効率（日予算 vs 実消化の乖離率）
- CTR/CPC の推移と異常検知（前週比・前月比）
- ROAS の評価（conversion_value_micros > 0 の場合のみ）

### フェーズ3：AI チャット（Tool Calling）

**APIルート**

`src/app/api/services/[serviceId]/ai/google-ads/chat/route.ts`

```typescript
export const maxDuration = 60
import { streamText } from 'ai'
import { AI_MODEL } from '@/lib/ai/config'

// ツール定義
const tools = {
  getCampaignMetrics: { /* キャンペーン指標取得 */ },
  getAdGroupMetrics:  { /* 広告グループ指標取得 */ },
  getKeywordAnalysis: { /* キーワード品質スコア分析（collect_keywords=true のみ）*/ },
  getBudgetUtilization: { /* 予算消化効率サマリ */ },
}
```

**Google Ads 専用 AI 分析の3つの切り口**

| 切り口 | 説明 | 主な入力データ |
|---|---|---|
| 予算消化効率評価 | 日予算 vs 実消化の乖離・キャンペーン単位の過剰/不足を検出 | `budget_amount_micros` vs `cost_micros` |
| CTR/CPC 異常検知 | 前週比で統計的に異常な変動があるキャンペーン・広告グループを特定 | `ctr`, `average_cpc_micros` 時系列 |
| キーワード品質スコア改善 | 品質スコアが低いキーワードの改善提案（`collect_keywords=true` のみ） | `quality_score`, `keyword_text` |

### AI ページ遷移

```
/projects/[projectId]/services/[serviceId]/google-ads/ai
  ├── /report   ← 週次/月次レポート
  └── /chat     ← AIチャット
```

---

## 9. 実装フェーズ・順序

### フェーズ 0：基盤構築（最初にやること）

1. `supabase/migrations/018_google_ads.sql` を Supabase Dashboard で実行
2. `.env.local` に `GOOGLE_ADS_DEVELOPER_TOKEN`・`GOOGLE_ADS_REDIRECT_URI` を追加
3. `src/lib/google-ads/auth.ts`（アクセストークン取得ユーティリティ）を作成
4. `src/lib/google-ads/api.ts`（`searchStream` ヘルパー）を作成
5. `services` テーブルの `service_type` check 制約に `'google_ads'` を追加
   ```sql
   ALTER TABLE services DROP CONSTRAINT IF EXISTS services_service_type_check;
   ALTER TABLE services ADD CONSTRAINT services_service_type_check
     CHECK (service_type IN ('instagram', 'gbp', 'line', 'lp', 'ga4', 'clarity', 'google_ads'));
   ```

### フェーズ 1：認証・設定

1. クライアント設定 API (`/api/clients/[clientId]/google-ads/`)
2. OAuth callback API (`/api/clients/google-ads/callback`)
3. サービス設定 API (`/api/services/[serviceId]/google-ads/config`)
4. クライアント設定ページに `GoogleAdsCredentialSection` 追加
5. 新規サービス作成ダイアログに `google_ads` 選択肢を追加

### フェーズ 2：バッチ

1. `src/app/api/batch/google-ads-daily/route.ts` を作成
2. `vercel.json` にCronを追加
3. `batch_job_logs` への書き込みを追加（既存パターンに倣う）

### フェーズ 3：ダッシュボード

1. ダッシュボードデータ API (`/api/services/[serviceId]/google-ads/summary` など)
2. `google-ads/analytics/page.tsx`（KPI カード・グラフ・テーブル）

### フェーズ 4：サマリー

既存 `summary_templates` 基盤を利用するため、ルーティングのみ追加。

### フェーズ 5：AI分析

Instagram AI分析の実装完了後に同パターンで実装。

---

## 10. Cursor 用プロンプト集

### 10-1. マイグレーション実行

```
supabase/migrations/018_google_ads.sql の内容を Supabase Dashboard の SQL Editor で実行してください。
また、services テーブルの service_type CHECK 制約に 'google_ads' を追加するSQLも実行してください。
```

### 10-2. Google Ads ライブラリ作成

```
以下の2ファイルを新規作成してください。

1. src/lib/google-ads/auth.ts
   - getGoogleAdsAccessToken(clientId: string): Promise<string> を実装
   - createSupabaseAdminClient を使って client_google_ads_credentials を取得
   - googleapis の OAuth2 クライアントで refresh_token からアクセストークンを取得
   - encrypt/decrypt は src/lib/crypto から import

2. src/lib/google-ads/api.ts
   - searchStream(params) 関数を実装（GOOGLE_ADS_IMPL_PLAN.md §6参照）
   - Google Ads API v18 の /googleAds:searchStream エンドポイントを呼ぶ
   - NDJSON レスポンスをパースして Record<string, unknown>[] を返す
   - developer-token と login-customer-id ヘッダーを付与
```

### 10-3. クライアント認証 API 作成

```
src/app/api/clients/[clientId]/google-ads/ 配下に以下のファイルを作成してください。
設計は src/app/api/clients/[clientId]/gbp/ を参考にしてください。

- credential/route.ts  (GET / POST / DELETE)
  - GET: client_google_ads_credentials の概要（auth_status / last_verified_at）を返す
  - POST: body { oauth_client_id, oauth_client_secret, manager_customer_id } を受け取り保存
  - DELETE: 認証情報を削除
- auth/route.ts  (GET)
  - Google OAuth2 認証URLを構築してリダイレクト
  - scope: https://www.googleapis.com/auth/adwords
  - state パラメータに clientId を含める

src/app/api/clients/google-ads/callback/route.ts  (GET)
  - code と state（clientId）を受け取り
  - refresh_token に交換して client_google_ads_credentials に保存
  - auth_status を 'active' に更新
  - 成功後はクライアント設定ページにリダイレクト
```

### 10-4. バッチ実装

```
src/app/api/batch/google-ads-daily/route.ts を作成してください。

要件:
- GET / POST どちらでも動作（Vercel Cron は GET）
- CRON_SECRET による認証（既存バッチと同じ実装）
- google_ads_service_configs を is_active=true で全件取得
- 各サービスごとに：
  1. service → project → client の順で client_id を取得
  2. getGoogleAdsAccessToken(clientId) でアクセストークン取得
  3. last_synced_at が NULL なら backfill_days 分、そうでなければ直近2日分を取得
  4. searchStream でキャンペーン・広告グループ日次データを取得
  5. collect_keywords=true なら キーワード日次データも取得
  6. upsert（onConflict で既存行を UPDATE）
  7. マスタ（campaigns / ad_groups / keywords）も upsert
  8. last_synced_at を更新
- batch_job_logs に job_name='google_ads_daily' で INSERT/UPDATE
- maxDuration = 300

GOOGLE_ADS_IMPL_PLAN.md §6 の GAQL クエリを参照してください。
```

### 10-5. ダッシュボード API 作成

```
src/app/api/services/[serviceId]/google-ads/ 配下に以下を作成してください。

- summary/route.ts (GET)
  - query: start, end（YYYY-MM-DD）
  - google_ads_campaign_daily を集計して返す
  - 返却: { impressions, clicks, cost, conversions, conversionValue, roas, daily: [...] }

- campaigns/route.ts (GET)
  - google_ads_campaigns とその直近30日指標を JOIN して返す

- ad-groups/route.ts (GET)
  - query: campaignId（必須）
  - google_ads_ad_groups とその直近30日指標を返す

- config/route.ts (GET / POST / PUT)
  - google_ads_service_configs の CRUD
```

### 10-6. フロントエンドページ作成

```
以下のページを新規作成してください。

1. src/app/(dashboard)/projects/[projectId]/services/[serviceId]/google-ads/analytics/page.tsx
   - 既存の GBP ダッシュボードページ（/gbp/dashboard/page.tsx）を参考に作成
   - KPI カード: インプレッション / クリック / 費用 / CV数 / ROAS
   - 日次トレンドグラフ（費用 vs CV数の折れ線グラフ）
   - キャンペーン別テーブル（Impressions / Clicks / CTR / CPC / Cost / CV / ROAS）
   - タブは [ダッシュボード / サマリー / AI分析 / 設定]

2. src/app/(dashboard)/projects/[projectId]/services/[serviceId]/google-ads/settings/page.tsx
   - google_ads_service_configs の表示・編集フォーム
   - collect_keywords トグル（ON 時に「キーワード収集を有効にすると追加費用が発生します」注記）
   - backfill_days 入力（1〜90日）

3. src/app/(dashboard)/clients/[clientId]/page.tsx に GoogleAdsCredentialSection を追加
   - InstagramTokenSection と同じパターン
   - 認証状態（auth_status）を表示
   - OAuth 認証ボタン（GET /api/clients/${clientId}/google-ads/auth へ遷移）

4. src/app/(dashboard)/projects/[projectId]/page.tsx の getServiceHref に追記:
   case 'google_ads':
     return `/projects/${projectId}/services/${serviceId}/google-ads/analytics`
```

### 10-7. サービス作成ダイアログへの追加

```
Google 広告サービスを新規作成できるよう、既存のサービス作成ダイアログを更新してください。

- service_type に 'google_ads' オプションを追加（ラベル: 「Google広告」）
- 作成後、/services/[serviceId]/google-ads/settings へリダイレクト
- 既存の Instagram / GBP / LINE の作成フローを参考にしてください
```

### 10-8. AI分析実装（フェーズ2以降）

```
以下の AI 分析ルートを実装してください。AI_ANALYSIS_IMPL_PLAN.md を参考に、
Instagram と同じ Vercel AI SDK（streamText / toDataStreamResponse）を使ってください。

1. src/app/api/services/[serviceId]/ai/google-ads/report/route.ts
   - POST: Google 広告データを取得してストリーミングレポートを生成
   - GOOGLE_ADS_IMPL_PLAN.md §8 のプロンプト骨格を使用
   - 分析の3切り口（予算消化効率 / CTR・CPC異常検知 / パフォーマンス評価）を含める

2. src/app/api/services/[serviceId]/ai/google-ads/chat/route.ts
   - Tool Calling を使ったインタラクティブチャット（maxSteps: 5）
   - ツール: getCampaignMetrics / getAdGroupMetrics / getBudgetUtilization
   - キーワード分析ツール getKeywordAnalysis は collect_keywords=true の場合のみ有効

3. src/app/(dashboard)/projects/[projectId]/services/[serviceId]/google-ads/ai/page.tsx
   - タブ: [週次レポート / AIチャット]
   - Instagram の ai/page.tsx と同じ UI パターン
```

---

## 付録：データ型変換

Google Ads API はマイクロ単位（1/1,000,000）で金額を返す。表示時は以下で変換：

```typescript
// マイクロ → 通常単位（円など）
export const microsToCurrency = (micros: number): number => micros / 1_000_000

// ROAS 算出
export const calcRoas = (
  conversionValueMicros: number,
  costMicros: number,
): number | null => {
  if (costMicros === 0) return null
  if (conversionValueMicros === 0) return null  // コンバージョン金額未設定
  return conversionValueMicros / costMicros
}

// CTR をパーセント表示
export const formatCtr = (ctr: number): string => `${(ctr * 100).toFixed(2)}%`

// CPC をマイクロから円表示
export const formatCpc = (avgCpcMicros: number): string =>
  `¥${Math.round(microsToCurrency(avgCpcMicros)).toLocaleString()}`
```

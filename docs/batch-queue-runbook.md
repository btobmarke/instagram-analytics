# バッチキュー（DB）運用メモ

## 概要

- **`batch_job_queue`**
  - **`weather_sync`**: プロジェクト単位で DB 内完結（天気 API）。
  - **その他の `job_name`**: Cron 分解用。ワーカーは **`dispatchQueueJobInProcess`** で処理（**自己 HTTP / `batch_proxy` は使わない**）。
    - 例: `external_data_project`, `ga4_collector_service`, `media_collector_account`, `weekly_ai_analysis_account` など。
    - **重いルート**（`insight-collector`, `story-*`, `lp-*`, `line-oam-daily`, `gbp-daily`）は同一プロセス内で **`NextRequest` + `POST` ハンドラ**を直接呼び出す（外部 `fetch` なし）。
- **`POST /api/internal/batch-queue-worker`**: `dequeue_batch_jobs` で最大 N 件取り出し、処理。Vercel Cron（毎分、`limit=15` 既定）で起動。
- **`POST /api/batch/weather-sync`**: 既定では **キューへ enqueue のみ**（全座標付きプロジェクト）。実データ取得はワーカー側。
- **Cron グループ**（`/api/batch/cron-groups/*`）: 既定 **`BATCH_CRON_GROUPS_USE_QUEUE` 未設定 or `true`** のとき、各スラッグは **直接 fetch せず** `enqueueCronBatchJobsForSlug` でキュー投入。従来の一括 HTTP に戻す: `BATCH_CRON_GROUPS_USE_QUEUE=false`。

## 環境変数

| 変数 | 説明 |
|------|------|
| `CRON_SECRET` / `BATCH_SECRET` | 既存バッチ認証。ワーカー・`weather-sync` POST・Cron グループ・キュー内の合成 `NextRequest` で使用 |
| `BATCH_WORKER_SECRET` | （任意）ワーカー専用。設定時は `Authorization: Bearer <BATCH_WORKER_SECRET>` でもワーカー起動可 |
| `BATCH_QUEUE_DISABLED` | `true` のとき `weather-sync` は従来の **一括インライン**処理（緊急用） |
| `BATCH_CRON_GROUPS_USE_QUEUE` | `false` で Cron グループが従来どおり **各バッチへ直接 POST** |
| `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | Cron グループの子 `fetch`（`USE_QUEUE=false` 時）に必要。キューワーカー内の合成 URL にも使用 |

## マイグレーション

`supabase/migrations/063_batch_job_queue_and_logs_extensions.sql` を適用後、キューが有効。

## 手動 API

- **`POST /api/batch/enqueue`**（Bearer **CRON_SECRET / BATCH_SECRET** のみ）  
  - Body: `{ "job_slug": "ga4-collector" }` … `enqueueCronBatchJobsForSlug` と同じ分解投入（Cron グループと同じスラッグ名）
- **`POST /api/batch/weather-sync/enqueue`**  
  - `{ "scope": "project", "project_id": "<uuid>" }` … ログインユーザー（プロジェクト参照可のみ）  
  - `{ "scope": "all_active_projects" }` … **Bearer CRON_SECRET / BATCH_SECRET のみ**

## 監視

- 子バッチ失敗: `cron-groups` が `notifyBatchError`（`cron_group:{id}`）。
- キュー行 `status = dead`: `last_error` を確認。ワーカーログと `batch_job_logs`（`project_id` 付き）を突合。

## 分割パラメータ（HTTP バッチ API ／ キュー `payload` の対応）

| バッチ | 絞り込み |
|--------|----------|
| `external-data` | `?project=<uuid>` |
| `project-metrics-aggregate` | `?project=<uuid>` |
| `google-ads-daily` | POST body `service_id` |
| `ga4-collector` / `clarity-collector` | POST body `service_id` |
| `media-collector` / `insight-collector` / `kpi-calc` | POST body `account_id` |
| `story-*` | POST body `account_id` |
| `ai-analysis` / `instagram-velocity-retro` | POST body `account_id`（週次は **UTC 月曜始まりの週**で冪等キー）。**シャード時は通知（notify）を送らない** |
| `lp-session-cleanup` / `lp-aggregate` | `?lp_site_id=<uuid>` |
| `line-oam-daily` | POST body `service_id` |
| `gbp-daily` | `?site_id=<gbp_site uuid>` |

## キュー `job_name` 一覧（代表）

Cron 分解後の主な `job_name` とペイロードの対応は `src/lib/batch/batch-enqueue-by-slug.ts` を参照。

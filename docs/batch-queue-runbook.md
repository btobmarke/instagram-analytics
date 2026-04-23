# バッチキュー（DB）運用メモ

## 概要

- **`batch_job_queue`**
  - **`weather_sync`**: プロジェクト単位で DB 内完結（天気 API）。
  - **`batch_proxy`**: ペイロードの `path` / `query` / `body` で **既存 `POST|GET /api/batch/*` をワーカーから呼び出す**（分割実行用）。`service_id` / `account_id` / `project_id` は任意（追跡用）。
- **`POST /api/internal/batch-queue-worker`**: `dequeue_batch_jobs` で最大 N 件取り出し、処理。Vercel Cron（毎分、`limit=15` 既定）で起動。
- **`POST /api/batch/weather-sync`**: 既定では **キューへ enqueue のみ**（全座標付きプロジェクト）。実データ取得はワーカー側。
- **Cron グループ**（`/api/batch/cron-groups/*`）: 既定 **`BATCH_CRON_GROUPS_USE_QUEUE` 未設定 or `true`** のとき、各スラッグは **直接 fetch せず** `enqueueCronBatchJobsForSlug` でキュー投入。従来の一括 HTTP に戻す: `BATCH_CRON_GROUPS_USE_QUEUE=false`。

## 環境変数

| 変数 | 説明 |
|------|------|
| `CRON_SECRET` / `BATCH_SECRET` | 既存バッチ認証。ワーカー・`weather-sync` POST・Cron グループで使用可 |
| `BATCH_WORKER_SECRET` | （任意）ワーカー専用。設定時は `Authorization: Bearer <BATCH_WORKER_SECRET>` でもワーカー起動可 |
| `BATCH_QUEUE_DISABLED` | `true` のとき `weather-sync` は従来の **一括インライン**処理（緊急用） |
| `BATCH_CRON_GROUPS_USE_QUEUE` | `false` で Cron グループが従来どおり **各バッチへ直接 POST** |
| `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | Cron グループの子 `fetch` に必要 |

## マイグレーション

`supabase/migrations/063_batch_job_queue_and_logs_extensions.sql` を適用後、キューが有効。

## 手動 API

- **`POST /api/batch/weather-sync/enqueue`**  
  - `{ "scope": "project", "project_id": "<uuid>" }` … ログインユーザー（プロジェクト参照可のみ）  
  - `{ "scope": "all_active_projects" }` … **Bearer CRON_SECRET / BATCH_SECRET のみ**

## 監視

- 子バッチ失敗: `cron-groups` が `notifyBatchError`（`cron_group:{id}`）。
- キュー行 `status = dead`: `last_error` を確認。ワーカーログと `batch_job_logs`（`project_id` 付き）を突合。

## 分割パラメータ（batch_proxy 経由で利用）

| バッチ | 絞り込み |
|--------|----------|
| `external-data` | `?project=<uuid>` |
| `project-metrics-aggregate` | `?project=<uuid>`（GET は Bearer / POST も Bearer でキューから可） |
| `google-ads-daily` | POST body `service_id` |
| `ga4-collector` / `clarity-collector` | POST body `service_id` |
| `media-collector` / `insight-collector` / `kpi-calc` | POST body `account_id` |
| `story-*` | POST body `account_id` |
| `lp-session-cleanup` / `lp-aggregate` | `?lp_site_id=<uuid>` |
| `line-oam-daily` | POST body `service_id`（**サービスごとに `line_oam_batch_runs` が1行**） |
| `gbp-daily` | `?site_id=<gbp_site uuid>`（**サイトごとに `gbp_batch_runs` が1行**。並列日次では run が複数になる） |

## 未移行ジョブ

`instagram-velocity-retro` / `ai-analysis` 等は **batch_proxy 1 件 = 従来の一括 HTTP** のまま。

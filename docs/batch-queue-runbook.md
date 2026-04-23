# バッチキュー（DB）運用メモ

## 概要

- **`batch_job_queue`**: プロジェクト単位ジョブ（現状 **`weather_sync`** のみ）。
- **`POST /api/internal/batch-queue-worker`**: `dequeue_batch_jobs` で最大 N 件取り出し、処理。Vercel Cron（毎分）で起動。
- **`POST /api/batch/weather-sync`**: 既定では **キューへ enqueue のみ**（全座標付きプロジェクト）。実データ取得はワーカー側。

## 環境変数

| 変数 | 説明 |
|------|------|
| `CRON_SECRET` / `BATCH_SECRET` | 既存バッチ認証。ワーカー・`weather-sync` POST・Cron グループで使用可 |
| `BATCH_WORKER_SECRET` | （任意）ワーカー専用。設定時は `Authorization: Bearer <BATCH_WORKER_SECRET>` でもワーカー起動可 |
| `BATCH_QUEUE_DISABLED` | `true` のとき `weather-sync` は従来の **一括インライン**処理（緊急用） |
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

## 未移行ジョブ

上記以外の `/api/batch/*` は従来どおり **HTTP 直実行**。順次 `batch_job_queue` + ハンドラに追加する。

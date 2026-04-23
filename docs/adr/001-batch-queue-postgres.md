# ADR 001: バッチキューに Postgres（`batch_job_queue`）を採用する

## ステータス

承認済み（初期実装）

## コンテキスト

- Vercel Cron はプロジェクト単位の並列実行に **HTTP ファンアウト**が必要。
- 外部 SaaS（Inngest / QStash）の導入コストと、既存の Supabase 運用を权衡した。

## 決定

- **第一版のキューは Postgres 上の `batch_job_queue` テーブル**と **`dequeue_batch_jobs` RPC（SKIP LOCKED）** で実装する。
- ワーカーは **`POST /api/internal/batch-queue-worker`**（Vercel Cron 毎分）。

## 結果

- **メリット**: 追加サービスなし、RLS/バックアップが DB と一体、撤退が容易。
- **デメリット**: 再試行・DLQ・可観測性は **自前実装**。高スループット時は専用キューへの移行を検討。

## 将来

スループットや運用要件が増えた場合、**QueueAdapter** 抽象の裏で Inngest / QStash に差し替える。

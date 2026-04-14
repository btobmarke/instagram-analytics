-- ============================================================
-- Migration 038: story insight batch support
--
-- - ig_story_insight_fact の時系列スナップショット重複を防ぐためのユニーク制約
-- - バッチ管理画面に表示するための schedule seed
-- ============================================================

-- 1時間に1回（時刻で丸めた fetched_at を使う）ため、同一時刻の再実行は upsert で上書きできるようにする
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_story_insight_fact_unique
  ON ig_story_insight_fact(media_id, metric_code, fetched_at);

CREATE INDEX IF NOT EXISTS idx_ig_story_insight_fact_media_id
  ON ig_story_insight_fact(media_id);

CREATE INDEX IF NOT EXISTS idx_ig_story_insight_fact_fetched_at
  ON ig_story_insight_fact(fetched_at DESC);

INSERT INTO batch_job_schedules (job_name, cron_expr, is_enabled, description)
VALUES
  ('hourly_story_insight_collector', '10 * * * *', true, '毎時10分: ストーリーインサイト収集（直近24時間）')
ON CONFLICT (job_name) DO NOTHING;


-- ストーリー投稿メタデータ（ig_media）を毎時同期するジョブ（Vercel Cron と整合）
INSERT INTO batch_job_schedules (job_name, cron_expr, is_enabled, description)
VALUES
  ('hourly_story_media_collector', '5 * * * *', true, '毎時5分(UTC): 公開中ストーリーを ig_media に同期')
ON CONFLICT (job_name) DO NOTHING;

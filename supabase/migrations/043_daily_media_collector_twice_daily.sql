-- 投稿一覧同期（media-collector）を JST 0:00 / 12:00 の2回に合わせる（Vercel Cron は UTC）
UPDATE batch_job_schedules
SET cron_expr = '0 3,15 * * *',
    description = 'JST 0:00/12:00（UTC 3:00/15:00）: 投稿一覧同期'
WHERE job_name = 'daily_media_collector';

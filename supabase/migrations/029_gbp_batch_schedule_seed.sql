-- ============================================================
-- Migration 029: batch_job_schedules に GBP デイリーバッチを追加
--
-- 背景:
--   gbp-daily バッチは vercel.json に登録済みだが、
--   batch_job_schedules テーブルへのシードが漏れていたため
--   バッチ管理画面（スケジュール設定・実行履歴）に表示されなかった。
-- ============================================================

INSERT INTO batch_job_schedules (job_name, cron_expr, is_enabled, description)
VALUES
  ('gbp_daily', '0 4 * * *', true, '毎日4:00(UTC): GBP デイリーデータ収集')
ON CONFLICT (job_name) DO NOTHING;

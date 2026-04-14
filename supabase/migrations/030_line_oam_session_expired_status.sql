-- ============================================================
-- Migration 030: line_oam_sessions.status に 'expired' を追加
--
-- 背景:
--   バッチが LINE OAM API から 401 を受け取った場合（Cookie 期限切れ）、
--   セッションを 'expired' 状態としてマークするため CHECK 制約を拡張する。
-- ============================================================

ALTER TABLE line_oam_sessions
  DROP CONSTRAINT IF EXISTS line_oam_sessions_status_check;

ALTER TABLE line_oam_sessions
  ADD CONSTRAINT line_oam_sessions_status_check
  CHECK (status IN ('active', 'revoked', 'expired'));

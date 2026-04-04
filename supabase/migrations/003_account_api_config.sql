-- ================================================
-- Migration 003: アカウントごとのAPIエンドポイント・バージョン設定
-- ================================================

ALTER TABLE ig_accounts
  ADD COLUMN IF NOT EXISTS api_base_url TEXT NOT NULL DEFAULT 'https://graph.facebook.com'
    CHECK (api_base_url IN ('https://graph.facebook.com', 'https://graph.instagram.com')),
  ADD COLUMN IF NOT EXISTS api_version  TEXT NOT NULL DEFAULT 'v22.0'
    CHECK (api_version IN ('v21.0', 'v22.0', 'v23.0'));

COMMENT ON COLUMN ig_accounts.api_base_url IS
  'Graph APIのベースURL。ビジネス/クリエイター: graph.facebook.com, 旧Basic Display: graph.instagram.com';
COMMENT ON COLUMN ig_accounts.api_version IS
  '使用するGraph APIバージョン';

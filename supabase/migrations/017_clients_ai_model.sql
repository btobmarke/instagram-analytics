-- クライアント単位で Anthropic モデル ID を選択（アプリ側で検証、DB は TEXT で保持）
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ai_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

COMMENT ON COLUMN clients.ai_model IS 'Anthropic API model id for AI features under this client (e.g. claude-sonnet-4-6)';

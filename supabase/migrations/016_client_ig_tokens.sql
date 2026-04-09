-- Migration 016: クライアント単位の Instagram アクセストークン管理
--
-- 背景: 従来はアカウント単位 (ig_account_tokens) でトークンを管理していたが、
--       同一クライアント配下の全 Instagram サービスが同じ Meta ビジネス認証情報を
--       共有するケースが多いため、クライアント単位に変更する。

CREATE TABLE IF NOT EXISTS client_ig_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  access_token_enc TEXT NOT NULL,
  token_type       TEXT NOT NULL DEFAULT 'long_lived'
                     CHECK (token_type IN ('short_lived', 'long_lived')),
  expires_at       TIMESTAMPTZ,
  scopes           TEXT[],
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_client_ig_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_client_ig_tokens_updated_at
  BEFORE UPDATE ON client_ig_tokens
  FOR EACH ROW EXECUTE FUNCTION trg_client_ig_tokens_updated_at();

ALTER TABLE client_ig_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON client_ig_tokens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON client_ig_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

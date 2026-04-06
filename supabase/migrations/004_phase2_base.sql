-- =============================================================
-- Phase 2: 業務管理系テーブル
-- clients / projects / services
-- =============================================================

-- クライアントテーブル
CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name   VARCHAR(255) NOT NULL,
  note          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- プロジェクトテーブル
CREATE TABLE IF NOT EXISTS projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_name   VARCHAR(255) NOT NULL,
  note           TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);

-- サービステーブル
CREATE TABLE IF NOT EXISTS services (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_type   VARCHAR(50) NOT NULL,  -- instagram / lp / x / line / google_ads / meta_ads / gbp / owned_media
  service_name   VARCHAR(255) NOT NULL,
  display_order  INT DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_service_type CHECK (
    service_type IN ('instagram','lp','x','line','google_ads','meta_ads','gbp','owned_media','summary')
  )
);

CREATE INDEX IF NOT EXISTS idx_services_project_id        ON services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_project_type      ON services(project_id, service_type);

-- Instagram連携テーブル（既存 ig_accounts と services を紐づける）
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  ig_account_ref_id     UUID REFERENCES ig_accounts(id) ON DELETE SET NULL,  -- 既存テーブル参照
  instagram_account_id  VARCHAR(255),   -- 外部アカウントID（旧来の識別子）
  username              VARCHAR(255),
  display_name          VARCHAR(255),
  status                VARCHAR(50) DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_service_id ON instagram_accounts(service_id);

-- updated_at 自動更新トリガー（共通関数がなければ作成）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_instagram_accounts_updated_at
  BEFORE UPDATE ON instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) - 認証済みユーザーのみアクセス可
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_users_all" ON clients
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON projects
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON services
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_users_all" ON instagram_accounts
  FOR ALL USING (auth.role() = 'authenticated');

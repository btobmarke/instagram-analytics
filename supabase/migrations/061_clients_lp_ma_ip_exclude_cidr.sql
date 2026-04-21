-- LP計測・MA（公開 LP API）用: クライアント単位の送信元 IP 除外（CIDR 一覧）
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lp_ma_ip_exclude_cidr JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN clients.lp_ma_ip_exclude_cidr IS
  'LP公開APIの計測対象外とするIPv4 CIDRの配列（例: ["203.0.113.10/32","198.51.100.0/24"]）。空配列で無効。';

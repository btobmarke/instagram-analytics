-- フォロワー一覧（Instagram 画面からのコピペ取り込み。Graph API では取得不可）

CREATE TABLE IF NOT EXISTS ig_account_follower_usernames (
  account_id UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  username  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, username)
);

CREATE INDEX IF NOT EXISTS idx_ig_account_follower_usernames_account
  ON ig_account_follower_usernames (account_id);

COMMENT ON TABLE ig_account_follower_usernames IS
  'コピペで取り込んだフォロワーのユーザー名（小文字で保存）。いいねユーザー分析でフォロワー判定に使用。';

ALTER TABLE ig_account_follower_usernames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_ig_account_follower_usernames"
  ON ig_account_follower_usernames FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_ig_account_follower_usernames"
  ON ig_account_follower_usernames FOR ALL TO service_role
  USING (true) WITH CHECK (true);

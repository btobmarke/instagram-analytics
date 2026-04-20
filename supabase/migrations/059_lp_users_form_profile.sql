-- LP 匿名ユーザーにフォーム送信などで取得した属性を紐づける（JSONB）
ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS form_profile_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN lp_users.form_profile_json IS 'LP側フォーム等で送信されたプロフィール（氏名・会社名など）。匿名キーと同一行に保存。';

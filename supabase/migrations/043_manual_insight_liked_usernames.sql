-- 手入力インサイト: API で取れない「いいね」ユーザー名一覧（コピペ取り込み用）
ALTER TABLE ig_media_manual_insight_extra
  ADD COLUMN IF NOT EXISTS liked_usernames text[];

COMMENT ON COLUMN ig_media_manual_insight_extra.liked_usernames IS
  'いいねしたユーザーのユーザー名の配列（Instagram 管理画面等からの手入力・貼り付け解析）。';

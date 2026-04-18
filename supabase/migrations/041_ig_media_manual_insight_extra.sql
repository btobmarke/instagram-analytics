-- ============================================================
-- 041: 投稿単位で Graph API 取得外のインサイトを手入力（複数行・登録日時）
-- ============================================================

CREATE TABLE IF NOT EXISTS ig_media_manual_insight_extra (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id        uuid NOT NULL REFERENCES ig_media(id) ON DELETE CASCADE,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  views_follower_pct              numeric(7, 3),
  views_non_follower_pct          numeric(7, 3),
  interactions_follower_pct       numeric(7, 3),
  interactions_non_follower_pct   numeric(7, 3),
  views_from_home                 integer,
  views_from_profile              integer,
  views_from_other                integer,
  note                            text,
  inserted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ig_media_manual_insight_extra_media_recorded
  ON ig_media_manual_insight_extra (media_id, recorded_at DESC);

COMMENT ON TABLE ig_media_manual_insight_extra IS
  'Instagram プロダクト上の内訳で Graph メディア insights に無い項目を手入力。1投稿に複数行可。';

ALTER TABLE ig_media_manual_insight_extra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_ig_media_manual_insight_extra"
  ON ig_media_manual_insight_extra FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_ig_media_manual_insight_extra"
  ON ig_media_manual_insight_extra FOR ALL TO service_role
  USING (true) WITH CHECK (true);

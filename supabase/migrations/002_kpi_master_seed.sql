-- ================================================
-- KPIマスタ初期データ
-- ================================================

INSERT INTO kpi_master (kpi_code, kpi_name, category, capability_type, formula_type, numerator_source, denominator_source, subject_level, unit_type, higher_is_better, display_order, description)
VALUES

-- ===== エンゲージメント系 =====
('engagement_rate',         'エンゲージメント率',     'engagement', 'DERIVED',     'ratio',  'total_interactions', 'reach',           'media',           'percent', true,  10,
 'リーチに対するエンゲージメント（いいね＋コメント＋保存＋シェア）の割合'),

('like_rate',               'いいね率',               'engagement', 'DERIVED',     'ratio',  'likes',              'reach',           'media',           'percent', true,  11,
 'リーチに対するいいね数の割合'),

('comment_rate',            'コメント率',             'engagement', 'DERIVED',     'ratio',  'comments',           'reach',           'media',           'percent', true,  12,
 'リーチに対するコメント数の割合'),

('save_rate',               '保存率',                 'engagement', 'DERIVED',     'ratio',  'saved',              'reach',           'media',           'percent', true,  13,
 'リーチに対する保存数の割合'),

('share_rate',              'シェア率',               'engagement', 'DERIVED',     'ratio',  'shares',             'reach',           'media',           'percent', true,  14,
 'リーチに対するシェア数の割合'),

('avg_engagement_per_post', '投稿あたり平均エンゲージメント', 'engagement', 'DERIVED', 'avg', 'total_interactions', NULL,             'account_weekly',  'count',   true,  15,
 '期間内の投稿あたり平均エンゲージメント数'),

-- ===== リーチ系 =====
('reach_per_post',          '投稿あたりリーチ数',     'reach',      'DIRECT_API',  NULL,     'reach',              NULL,              'media',           'count',   true,  20,
 '投稿1件あたりのリーチ数'),

('impressions_per_post',    '投稿あたりインプレッション', 'reach',   'DIRECT_API',  NULL,     'impressions',        NULL,              'media',           'count',   true,  21,
 '投稿1件あたりのインプレッション数'),

('avg_reach_per_post',      '週平均投稿リーチ',       'reach',      'DERIVED',     'avg',    'reach',              NULL,              'account_weekly',  'count',   true,  22,
 '期間内の投稿あたり平均リーチ数'),

('account_reach_daily',     'アカウント日次リーチ',   'reach',      'DIRECT_API',  NULL,     'reach',              NULL,              'account_daily',   'count',   true,  23,
 'アカウント全体の日次リーチ数'),

('impressions_to_reach',    'インプレッション/リーチ比', 'reach',   'DERIVED',     'ratio',  'impressions',        'reach',           'media',           'index',   true,  24,
 'リーチ1人あたりの平均表示回数（反復表示度）'),

-- ===== 成長系 =====
('follower_count',          'フォロワー数',           'growth',     'DIRECT_API',  NULL,     'followers_count',    NULL,              'account_daily',   'count',   true,  30,
 '現在のフォロワー数'),

('follower_gain_daily',     '日次フォロワー増減',     'growth',     'DIRECT_API',  NULL,     'follower_count',     NULL,              'account_daily',   'count',   true,  31,
 '1日あたりのフォロワー増減数'),

('follower_gain_weekly',    '週次フォロワー増減',     'growth',     'DERIVED',     'delta',  'followers_count',    NULL,              'account_weekly',  'count',   true,  32,
 '週間のフォロワー増減数'),

('follower_gain_monthly',   '月次フォロワー増減',     'growth',     'DERIVED',     'delta',  'followers_count',    NULL,              'account_monthly', 'count',   true,  33,
 '月間のフォロワー増減数'),

('follower_growth_rate',    'フォロワー成長率',       'growth',     'DERIVED',     'ratio',  'follower_gain_monthly', 'followers_count', 'account_monthly', 'percent', true, 34,
 '月間フォロワー増加率'),

('profile_visits',          'プロフィール訪問数',     'growth',     'DIRECT_API',  NULL,     'profile_visits',     NULL,              'account_daily',   'count',   true,  35,
 'プロフィールページへの訪問数'),

('website_clicks',          'Webサイトクリック数',    'conversion', 'DIRECT_API',  NULL,     'website_clicks',     NULL,              'account_daily',   'count',   true,  40,
 'プロフィールのWebサイトリンクのクリック数'),

-- ===== コンテンツ系 =====
('post_frequency_weekly',   '週間投稿頻度',           'content',    'DERIVED',     'sum',    'media_id',           NULL,              'account_weekly',  'count',   true,  50,
 '週間の投稿数'),

('reels_ratio',             'リールの投稿比率',       'content',    'DERIVED',     'ratio',  'reels_count',        'total_posts',     'account_weekly',  'percent', true,  51,
 '全投稿に占めるリールの割合'),

('video_view_rate',         '動画視聴率',             'content',    'DERIVED',     'ratio',  'video_views',        'reach',           'media',           'percent', true,  52,
 'リーチに対する動画再生数の割合（動画・リール投稿）'),

('saves_per_post',          '保存数/投稿',            'engagement', 'DIRECT_API',  NULL,     'saved',              NULL,              'media',           'count',   true,  16,
 '投稿1件あたりの保存数'),

('comments_per_post',       'コメント数/投稿',        'engagement', 'DIRECT_API',  NULL,     'comments',           NULL,              'media',           'count',   true,  17,
 '投稿1件あたりのコメント数')

ON CONFLICT (kpi_code) DO NOTHING;

-- ================================================
-- バッチスケジュール初期データ
-- ================================================

INSERT INTO batch_job_schedules (job_name, cron_expr, is_enabled, description)
VALUES
  ('hourly_media_insight_collector',   '0 * * * *',     true, '毎時0分: 投稿インサイト収集'),
  ('hourly_account_insight_collector', '15 * * * *',    true, '毎時15分: アカウントインサイト収集'),
  ('daily_media_collector',            '30 2 * * *',    true, '毎日2:30: 投稿一覧同期'),
  ('daily_token_refresh',              '0 3 * * *',     true, '毎日3:00: アクセストークン更新'),
  ('kpi_calc_batch',                   '45 * * * *',    true, '毎時45分: KPI計算バッチ'),
  ('weekly_ai_analysis',               '0 6 * * 1',     true, '毎週月曜6:00: 週次AI分析'),
  ('monthly_ai_analysis',              '0 7 1 * *',     true, '毎月1日7:00: 月次AI分析')
ON CONFLICT (job_name) DO NOTHING;

-- ================================================
-- デフォルトプロンプト設定
-- ================================================

INSERT INTO analysis_prompt_settings (prompt_type, prompt_text, is_active, version)
VALUES
  ('post_analysis',
   E'以下の観点で投稿を分析してください：\n1. リーチとエンゲージメントの評価（業界平均との比較）\n2. 保存率・シェア率から読み取れるコンテンツの価値\n3. キャプションの効果性\n4. 改善提案（次回の投稿に活かせる具体的なアドバイス）',
   true, 1),

  ('post_comparison',
   E'複数の投稿を比較して以下を分析してください：\n1. パフォーマンスの差異要因\n2. 高パフォーマンス投稿の共通点\n3. 低パフォーマンス投稿の課題\n4. 今後の投稿戦略への示唆',
   true, 1),

  ('account_weekly',
   E'週次レポートとして以下を分析してください：\n1. 今週の総合パフォーマンス評価\n2. KPI達成状況と課題\n3. 注目すべき投稿とその要因\n4. 来週の推奨アクション（具体的な投稿テーマ・形式・頻度）',
   true, 1),

  ('account_monthly',
   E'月次レポートとして以下を分析してください：\n1. 月間パフォーマンストレンド\n2. フォロワー成長の要因分析\n3. コンテンツ戦略の有効性評価\n4. 翌月の戦略提案（目標設定・コンテンツカレンダーの方向性）',
   true, 1)

ON CONFLICT DO NOTHING;

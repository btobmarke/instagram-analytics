-- ============================================================
-- 037_seed_kpi_tree_templates.sql
-- すぐ使える KPIツリーテンプレ（グローバル）をいくつか投入する seed
--
-- 方針:
-- - 既に同じ template_key が存在する場合は何もしない（上書きしない）
-- - 指標は fetchMetricsByRefs が対応している "table.field" 形式のみを使用する
-- ============================================================

DO $$
DECLARE
  v_tpl_id uuid;
  v_root_id uuid;
  v_child_id uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- Instagram: アカウント×投稿 基本
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM kpi_tree_templates WHERE template_key = 'instagram_basic_v1') THEN
    INSERT INTO kpi_tree_templates (template_key, name, description, scope, target_industry, version_no, is_active)
    VALUES (
      'instagram_basic_v1',
      'Instagram（基本）',
      'Instagramの代表的なアカウント指標（reach/engagement）と、投稿（FEED/REELS）の主要指標をまとめた基本テンプレです。',
      'service_type',
      NULL,
      1,
      true
    )
    RETURNING id INTO v_tpl_id;

    -- root folder
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, NULL, 0, 'Instagram KPI', 'folder', 'instagram', NULL)
    RETURNING id INTO v_root_id;

    -- account (daily) - ig_account_insight_fact.*
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 0, 'アカウント（日次）', 'folder', 'instagram', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, 'リーチ',               'leaf', 'instagram', 'ig_account_insight_fact.reach'),
      (v_tpl_id, v_child_id, 1, 'エンゲージしたアカウント', 'leaf', 'instagram', 'ig_account_insight_fact.accounts_engaged'),
      (v_tpl_id, v_child_id, 2, '総インタラクション',     'leaf', 'instagram', 'ig_account_insight_fact.total_interactions'),
      (v_tpl_id, v_child_id, 3, 'いいね',               'leaf', 'instagram', 'ig_account_insight_fact.likes'),
      (v_tpl_id, v_child_id, 4, 'コメント',             'leaf', 'instagram', 'ig_account_insight_fact.comments'),
      (v_tpl_id, v_child_id, 5, 'シェア',               'leaf', 'instagram', 'ig_account_insight_fact.shares'),
      (v_tpl_id, v_child_id, 6, '保存',                 'leaf', 'instagram', 'ig_account_insight_fact.saves');

    -- feed - ig_media_insight_feed.*
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 1, '投稿（FEED）', 'folder', 'instagram', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '閲覧数',             'leaf', 'instagram', 'ig_media_insight_feed.views'),
      (v_tpl_id, v_child_id, 1, 'リーチ',             'leaf', 'instagram', 'ig_media_insight_feed.reach'),
      (v_tpl_id, v_child_id, 2, '総インタラクション', 'leaf', 'instagram', 'ig_media_insight_feed.total_interactions'),
      (v_tpl_id, v_child_id, 3, 'いいね',             'leaf', 'instagram', 'ig_media_insight_feed.likes'),
      (v_tpl_id, v_child_id, 4, 'コメント',           'leaf', 'instagram', 'ig_media_insight_feed.comments'),
      (v_tpl_id, v_child_id, 5, 'シェア',             'leaf', 'instagram', 'ig_media_insight_feed.shares'),
      (v_tpl_id, v_child_id, 6, '保存',               'leaf', 'instagram', 'ig_media_insight_feed.saved');

    -- reels - ig_media_insight_reels.*
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 2, '投稿（REELS）', 'folder', 'instagram', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '閲覧数',             'leaf', 'instagram', 'ig_media_insight_reels.views'),
      (v_tpl_id, v_child_id, 1, 'リーチ',             'leaf', 'instagram', 'ig_media_insight_reels.reach'),
      (v_tpl_id, v_child_id, 2, '総インタラクション', 'leaf', 'instagram', 'ig_media_insight_reels.total_interactions'),
      (v_tpl_id, v_child_id, 3, 'いいね',             'leaf', 'instagram', 'ig_media_insight_reels.likes'),
      (v_tpl_id, v_child_id, 4, 'コメント',           'leaf', 'instagram', 'ig_media_insight_reels.comments'),
      (v_tpl_id, v_child_id, 5, 'シェア',             'leaf', 'instagram', 'ig_media_insight_reels.shares'),
      (v_tpl_id, v_child_id, 6, '保存',               'leaf', 'instagram', 'ig_media_insight_reels.saved');
  END IF;

  -- -------------------------------------------------------------------------
  -- GBP: 店舗集客 基本
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM kpi_tree_templates WHERE template_key = 'gbp_basic_v1') THEN
    INSERT INTO kpi_tree_templates (template_key, name, description, scope, target_industry, version_no, is_active)
    VALUES (
      'gbp_basic_v1',
      'GBP（基本）',
      'Googleビジネスプロフィールの検索/マップ表示→行動（電話/経路/サイト）と、口コミ（件数/評価）をまとめた基本テンプレです。',
      'service_type',
      'restaurant',
      1,
      true
    )
    RETURNING id INTO v_tpl_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, NULL, 0, 'GBP KPI', 'folder', 'gbp', NULL)
    RETURNING id INTO v_root_id;

    -- performance
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 0, '表示・行動（Performance）', 'folder', 'gbp', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '検索（モバイル）表示', 'leaf', 'gbp', 'gbp_performance_daily.business_impressions_mobile_search'),
      (v_tpl_id, v_child_id, 1, '検索（PC）表示',       'leaf', 'gbp', 'gbp_performance_daily.business_impressions_desktop_search'),
      (v_tpl_id, v_child_id, 2, 'マップ（モバイル）表示', 'leaf', 'gbp', 'gbp_performance_daily.business_impressions_mobile_maps'),
      (v_tpl_id, v_child_id, 3, 'マップ（PC）表示',       'leaf', 'gbp', 'gbp_performance_daily.business_impressions_desktop_maps'),
      (v_tpl_id, v_child_id, 4, '電話クリック',         'leaf', 'gbp', 'gbp_performance_daily.call_clicks'),
      (v_tpl_id, v_child_id, 5, '経路リクエスト',       'leaf', 'gbp', 'gbp_performance_daily.business_direction_requests'),
      (v_tpl_id, v_child_id, 6, 'サイトクリック',       'leaf', 'gbp', 'gbp_performance_daily.website_clicks'),
      (v_tpl_id, v_child_id, 7, '会話（メッセージ）',   'leaf', 'gbp', 'gbp_performance_daily.business_conversations');

    -- reviews
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 1, '口コミ（Reviews）', 'folder', 'gbp', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '口コミ件数（コメントあり）', 'leaf', 'gbp', 'gbp_reviews.comment'),
      (v_tpl_id, v_child_id, 1, '平均評価（★）',           'leaf', 'gbp', 'gbp_reviews.star_rating'),
      (v_tpl_id, v_child_id, 2, '返信件数',               'leaf', 'gbp', 'gbp_reviews.reply_comment');
  END IF;

  -- -------------------------------------------------------------------------
  -- LINE OAM: 友だち・来店 基本
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM kpi_tree_templates WHERE template_key = 'line_oam_basic_v1') THEN
    INSERT INTO kpi_tree_templates (template_key, name, description, scope, target_industry, version_no, is_active)
    VALUES (
      'line_oam_basic_v1',
      'LINE（基本）',
      '友だち増減（contacts/blocks）と配信到達（target_reaches）を中心に、ショップカードの利用状況も見る基本テンプレです。',
      'service_type',
      'restaurant',
      1,
      true
    )
    RETURNING id INTO v_tpl_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, NULL, 0, 'LINE KPI', 'folder', 'line', NULL)
    RETURNING id INTO v_root_id;

    -- friends daily
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 0, '友だち（日次）', 'folder', 'line', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '友だち数（contacts）', 'leaf', 'line', 'line_oam_friends_daily.contacts'),
      (v_tpl_id, v_child_id, 1, 'ブロック数',           'leaf', 'line', 'line_oam_friends_daily.blocks'),
      (v_tpl_id, v_child_id, 2, '到達（target_reaches）', 'leaf', 'line', 'line_oam_friends_daily.target_reaches');

    -- shopcard status (集計値)
    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, v_root_id, 1, 'ショップカード（集計）', 'folder', 'line', NULL)
    RETURNING id INTO v_child_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_child_id, 0, '発行カード数',         'leaf', 'line', 'line_oam_shopcard_status.issued_cards'),
      (v_tpl_id, v_child_id, 1, '有効カード数',         'leaf', 'line', 'line_oam_shopcard_status.valid_cards'),
      (v_tpl_id, v_child_id, 2, '来店ポイント付与',     'leaf', 'line', 'line_oam_shopcard_status.store_visit_points'),
      (v_tpl_id, v_child_id, 3, '特典利用（vouchers_used）', 'leaf', 'line', 'line_oam_shopcard_status.vouchers_used');
  END IF;

  -- -------------------------------------------------------------------------
  -- LP: 基本（集計 metric_summaries 中心）
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM kpi_tree_templates WHERE template_key = 'lp_basic_v1') THEN
    INSERT INTO kpi_tree_templates (template_key, name, description, scope, target_industry, version_no, is_active)
    VALUES (
      'lp_basic_v1',
      'LP（基本）',
      'LPの主要KPI（セッション数/ユーザー数/平均滞在/ホット率）を日次で見る基本テンプレです。',
      'service_type',
      NULL,
      1,
      true
    )
    RETURNING id INTO v_tpl_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref)
    VALUES (v_tpl_id, NULL, 0, 'LP KPI', 'folder', 'lp', NULL)
    RETURNING id INTO v_root_id;

    INSERT INTO kpi_tree_template_nodes (template_id, parent_id, sort_order, label, node_type, service_type, metric_ref) VALUES
      (v_tpl_id, v_root_id, 0, 'セッション数',     'leaf', 'lp', 'metric_summaries.session_count'),
      (v_tpl_id, v_root_id, 1, 'ユーザー数',       'leaf', 'lp', 'metric_summaries.user_count'),
      (v_tpl_id, v_root_id, 2, '平均滞在秒',       'leaf', 'lp', 'metric_summaries.avg_stay_seconds'),
      (v_tpl_id, v_root_id, 3, 'ホット率（%）',   'leaf', 'lp', 'metric_summaries.hot_session_rate');
  END IF;
END $$;


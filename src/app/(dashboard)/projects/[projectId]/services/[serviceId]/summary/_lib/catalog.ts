import type { MetricCard } from './types'

const card = (
  table: string,
  field: string,
  label: string,
  category: string,
  description?: string,
): MetricCard => ({
  id: `${table}.${field}`,
  label,
  category,
  fieldRef: `${table}.${field}`,
  description,
})

// ── Instagram ─────────────────────────────────────────────────────
const IG_ACCOUNT: [string, string, string][] = [
  ['follower_count',     'フォロワー数',             'アカウントをフォローしているユーザーの人数（日次スナップショット）。'],
  ['reach',              'リーチ',                   'コンテンツが届いたユニークアカウントの数。同じアカウントが複数回見ても1としてカウント。'],
  ['views',              '閲覧数',                   'コンテンツが閲覧された総回数。同一アカウントの複数回閲覧も全てカウント。'],
  ['reach@@media_product_type=FEED', 'リーチ（フィード）', '日次リーチのうち、フィード表面に起因する推定内訳。'],
  ['reach@@media_product_type=REELS', 'リーチ（リール）', '日次リーチのうち、リール表面に起因する推定内訳。'],
  ['reach@@media_product_type=STORY', 'リーチ（ストーリー）', '日次リーチのうち、ストーリー表面に起因する推定内訳。'],
  ['reach@@follow_type=FOLLOWER', 'リーチ（フォロワー）', '日次リーチのうち、フォロワー由来の推定内訳。'],
  ['reach@@follow_type=NON_FOLLOWER', 'リーチ（非フォロワー）', '日次リーチのうち、非フォロワー由来の推定内訳。'],
  ['views@@follower_type=FOLLOWER', '閲覧数（フォロワー）', '日次閲覧数のうち、フォロワー由来の推定内訳。'],
  ['views@@follower_type=NON_FOLLOWER', '閲覧数（非フォロワー）', '日次閲覧数のうち、非フォロワー由来の推定内訳。'],
  ['views@@media_product_type=FEED', '閲覧数（フィード）', '日次閲覧数のうち、フィード表面に起因する推定内訳。'],
  ['views@@media_product_type=REELS', '閲覧数（リール）', '日次閲覧数のうち、リール表面に起因する推定内訳。'],
  ['views@@media_product_type=STORY', '閲覧数（ストーリー）', '日次閲覧数のうち、ストーリー表面に起因する推定内訳。'],
  ['profile_views',      'プロフィール閲覧数',       'プロフィールページが閲覧された回数。'],
  ['accounts_engaged',   'エンゲージしたアカウント数','いいね・コメント・保存・シェアなど何らかのアクションをとったユニークアカウント数。'],
  ['total_interactions', 'インタラクション合計',      'いいね・コメント・保存・シェアなど全アクションの合計数。'],
  ['likes',              'いいね数',                 '投稿・コンテンツに付いたいいねの総数。'],
  ['comments',           'コメント数',               '投稿に付いたコメントの総数。'],
  ['shares',             'シェア数',                 'コンテンツが他ユーザーにシェアされた回数。'],
  ['saves',              '保存数',                   'コンテンツがコレクションに保存された回数。'],
  ['replies',            '返信数',                   'ストーリーズやリールへのDM返信数。'],
  ['profile_links_taps', 'プロフィールリンクタップ', 'プロフィールに設置したリンクがタップされた回数。'],
  ['online_followers',   'オンラインフォロワー',     'オンライン状態に近いフォロワー推定（取得できるアカウントのみ）。'],
  ['engaged_audience_demographics@@dimension_code=country@@dimension_value=US@@period=lifetime', 'エンゲージ層（国: US）', '直近90日のエンゲージしたユーザーの国別内訳（該当セグメント）。'],
  ['follower_demographics@@dimension_code=gender@@dimension_value=FEMALE@@period=lifetime', 'フォロワー層（性別: 女性）', '直近90日のフォロワー属性（該当セグメント）。'],
]

/**
 * メディア `profile_activity`（action_type breakdown）を ig_media_insight_fact に保存する際の metric_code。
 * 値はAPIの breakdown 次元（小文字化）に追従する。
 */
const IG_MEDIA_PROFILE_ACTIVITY: [string, string, string][] = [
  ['profile_activity_bio_link_click', 'プロフィール行動（リンク）', 'プロフィール上のリンク（bio link 等）に関するアクション推定。'],
  ['profile_activity_call', 'プロフィール行動（電話）', 'プロフィール上の通話アクション推定。'],
  ['profile_activity_direction', 'プロフィール行動（道順）', 'プロフィール上の道順/ナビゲーション起動に関するアクション推定。'],
  ['profile_activity_email', 'プロフィール行動（メール）', 'プロフィール上のメール起動等に関するアクション推定。'],
  ['profile_activity_text_message', 'プロフィール行動（SMS）', 'プロフィール上のSMS/テキストメッセージ起動に関するアクション推定。'],
  ['profile_activity_address', 'プロフィール行動（住所）', 'プロフィール上の住所表示/操作に関するアクション推定。'],
  ['profile_activity_website_click', 'プロフィール行動（Web）', 'プロフィール上のウェブサイト遷移に関するアクション推定。'],
]

const IG_FEED: [string, string, string][] = [
  ['views',              '閲覧数',                   'フィード投稿が表示（閲覧）された延べ回数。'],
  ['reach',              'リーチ',                   'フィード投稿が届いたユニークアカウント数。'],
  ['likes',              'いいね数',                 'フィード投稿に付いたいいね数。'],
  ['comments',           'コメント数',               'フィード投稿に付いたコメント数。'],
  ['shares',             'シェア数',                 'フィード投稿がシェアされた回数。'],
  ['saved',              '保存数',                   'フィード投稿がコレクションに保存された回数。'],
  ['profile_visits',     'プロフィール訪問数',       'フィード投稿からプロフィールページへ遷移した回数。'],
  ['follows',            'フォロー数',               'フィード投稿を見てフォローしたアカウント数。'],
  ['total_interactions', 'インタラクション合計',      'いいね・コメント・保存・シェア等、全アクションの合計数。'],
  ...IG_MEDIA_PROFILE_ACTIVITY,
]
const IG_REELS: [string, string, string][] = [
  ['views',                          '閲覧数',         'リールが再生された延べ回数。'],
  ['reach',                          'リーチ',         'リールが届いたユニークアカウント数。'],
  ['likes',                          'いいね数',       'リールに付いたいいね数。'],
  ['comments',                       'コメント数',     'リールに付いたコメント数。'],
  ['shares',                         'シェア数',       'リールがシェアされた回数。'],
  ['saved',                          '保存数',         'リールが保存された回数。'],
  ['ig_reels_video_view_total_time', '総再生時間',     '全ユーザーによるリールの合計再生時間（ミリ秒）。'],
  ['ig_reels_avg_watch_time',        '平均視聴時間',   '1再生あたりの平均視聴時間（ミリ秒）。動画の完成度の目安。'],
  ['total_interactions',             'インタラクション合計', 'いいね・コメント・保存・シェア等の合計数。'],
  ...IG_MEDIA_PROFILE_ACTIVITY,
]
const IG_STORY: [string, string, string][] = [
  ['views',        '閲覧数',       'ストーリーが閲覧された延べ回数。'],
  ['reach',        'リーチ',       'ストーリーが届いたユニークアカウント数。'],
  ['taps_forward', '次へタップ',   'ストーリーを途中でスキップして次へ進んだ回数。多いほど離脱しやすいコンテンツの可能性。'],
  ['taps_back',    '前へタップ',   '前のストーリーに戻った回数。見返されるほど興味を引いているコンテンツの指標。'],
  ['exits',        '離脱数',       'ストーリーを見ている途中でアプリ等を閉じた回数。'],
  ['replies',      '返信数',       'ストーリーへDMで返信された回数。エンゲージメントの高さを示す。'],
  ['navigation_tap_forward', 'ナビ（次へタップ）', '公式 `navigation` breakdown の tap_forward（次へ）。'],
  ['navigation_tap_back',    'ナビ（前へタップ）', '公式 `navigation` breakdown の tap_back（前へ）。'],
  ['navigation_tap_exit',    'ナビ（離脱）',       '公式 `navigation` breakdown の tap_exit。'],
  ['navigation_swipe_forward','ナビ（スワイプ）',  '公式 `navigation` breakdown の swipe_forward。'],
  ...IG_MEDIA_PROFILE_ACTIVITY,
]

// ── GBP ───────────────────────────────────────────────────────────
const GBP_PERF: [string, string, string][] = [
  ['business_impressions_desktop_search', 'デスクトップ検索表示',    'PCのGoogle検索結果にビジネスが表示された回数。'],
  ['business_impressions_mobile_search',  'モバイル検索表示',        'スマートフォンのGoogle検索結果にビジネスが表示された回数。'],
  ['business_impressions_desktop_maps',   'デスクトップマップ表示',  'PCのGoogleマップにビジネスが表示された回数。'],
  ['business_impressions_mobile_maps',    'モバイルマップ表示',      'スマートフォンのGoogleマップにビジネスが表示された回数。'],
  ['business_conversations',              'メッセージ数',            'Googleビジネスプロフィール経由でのメッセージ送信数。'],
  ['business_direction_requests',         'ルート検索数',            'Googleマップでビジネスへのルートを検索した回数。'],
  ['call_clicks',                         '電話クリック数',          'ビジネスプロフィールの電話番号がクリック（タップ）された回数。'],
  ['website_clicks',                      'ウェブサイトクリック数',  'ビジネスプロフィールのウェブサイトURLがクリックされた回数。'],
  ['business_bookings',                   '予約数',                  'ビジネスプロフィール経由で予約が入った回数。'],
  ['business_food_orders',                'フード注文数',            'ビジネスプロフィール経由でのフード注文数。'],
  ['business_food_menu_clicks',           'フードメニュークリック数','フードメニューがクリックされた回数。'],
]
/** Performance API searchkeywords.impressions.monthly（バッチで gbp_search_keyword_monthly に保存） */
const GBP_SEARCH_KW: [string, string, string][] = [
  [
    'impressions@@search_keyword=your_keyword@@year=2025@@month=1',
    '検索KWインプレッション（月次・指定語）',
    'テンプレでは your_keyword / year / month を実データに合わせて差し替え。暦月の期間、または単一期間がその月と重なるときに値が入ります。閾値のみのキーワードは impressions が null です。',
  ],
]
const GBP_REVIEW: [string, string, string][] = [
  ['star_rating',       '星評価',    'クチコミに付けられた星の評価（1〜5）。'],
  ['comment',           'クチコミ本文', '投稿されたクチコミのテキスト内容。'],
  ['reviewer_name',     '投稿者名',  'クチコミを投稿したGoogleアカウントの表示名。'],
  ['create_time',       '投稿日時',  'クチコミが投稿された日時。'],
  ['reply_comment',     '返信本文',  'ビジネスオーナーが返信したテキスト内容。'],
  ['reply_update_time', '返信日時',  'ビジネスオーナーが返信した日時。'],
]

// ── LINE ──────────────────────────────────────────────────────────
const LINE_FRIENDS: [string, string, string][] = [
  ['contacts',       '友だち数',           'LINEアカウントを友だちとして追加しているアカウントの累計数。'],
  ['target_reaches', 'ターゲットリーチ数', 'メッセージ配信が可能なアクティブな友だちの数（ブロック除く）。'],
  ['blocks',         'ブロック数',         '友だちの中でアカウントをブロックしているユーザー数。'],
]
const LINE_ATTR: [string, string, string][] = [
  ['gender',     '性別',   '友だちの性別分布（男性・女性・不明）。'],
  ['age',        '年齢層', '友だちの年齢層分布（例: 15〜19歳、20〜24歳 等）。'],
  ['percentage', '割合',   '各属性（性別・年齢等）が友だち全体に占める割合（%）。'],
]
const LINE_SHOPCARD: [string, string, string][] = [
  ['valid_cards',             '有効カード数',           '現在有効なショップカードを保有しているユーザー数。'],
  ['issued_cards',            '発行カード数',           '発行されたショップカードの累計数。'],
  ['store_visit_points',      '来店ポイント数',         '来店スタンプ等で付与されたポイントの累計。'],
  ['welcome_bonuses_awarded', 'ウェルカムボーナス付与数', '初回登録時に付与されるウェルカムボーナスの付与回数。'],
  ['expired_points',          '期限切れポイント数',     '有効期限切れになったポイントの累計数。'],
  ['vouchers_awarded',        '特典付与数',             'スタンプ達成等で特典が付与された回数。'],
  ['vouchers_used',           '特典利用数',             '付与された特典が実際に利用された回数。'],
]
const LINE_POINT: [string, string, string][] = [
  ['point', 'ポイント値', 'ポイント分布の各ポイント数（例: 0pt, 1pt, 2pt...）。'],
  ['users', 'ユーザー数', '対応するポイントを保有しているユーザー数。'],
]
const LINE_TXN: [string, string, string][] = [
  ['customer_id', '顧客ID',      'トランザクションに紐づく顧客の識別ID。'],
  ['point_type',  'ポイント種別', 'ポイントの種類（来店/特典/キャンペーン等）。'],
  ['points',      'ポイント数',  'トランザクション1件あたりのポイント数。'],
]

// ── LP ────────────────────────────────────────────────────────────
const LP_METRICS: [string, string, string][] = [
  ['session_count',    'セッション数',          '集計期間内のセッション（訪問）の総数。'],
  ['user_count',       'ユーザー数',            '集計期間内にサイトを訪れたユニークユーザー数。'],
  ['avg_stay_seconds', '平均滞在時間（秒）',    '1セッションあたりの平均滞在時間（秒）。値が高いほど関心度が高い。'],
  ['hot_session_rate', 'HOTセッション率',       'HOT判定（高エンゲージメント）のセッションが全体に占める割合（0〜1）。'],
]
const LP_SESSION: [string, string, string][] = [
  ['duration_seconds',    '滞在時間（秒）',             '1セッションの開始〜終了までの経過時間（秒）。'],
  ['session_intent_score','セッションインテントスコア',  'セッション全体の購買意欲を示すスコア。スクロール・クリック等の行動から算出。'],
  ['interaction_count',   'インタラクション数',          'セッション内のクリック・スクロール等のインタラクション回数。'],
  ['referrer_source',     '流入元',                     'セッションの流入元（例: Google検索、SNS、直接アクセス等）。'],
  ['landing_page_url',    'ランディングページURL',       'セッションで最初に訪問したページのURL。'],
  ['exit_page_url',       '離脱ページURL',               'セッションで最後に離脱したページのURL。'],
]
const LP_PAGE_VIEW: [string, string, string][] = [
  ['page_url',          'ページURL',              '閲覧されたページのURL。'],
  ['scroll_percent_max','最大スクロール率（%）',  'そのページで最もスクロールした位置（ページ全体の何%まで見たか）。'],
  ['stay_seconds',      '滞在時間（秒）',         'そのページに滞在した時間（秒）。'],
]
const LP_EVENT: [string, string, string][] = [
  ['intent_score', 'インテントスコア', 'イベント（クリック・フォーム送信等）ごとに付与される購買意欲スコア。'],
]
const LP_USER: [string, string, string][] = [
  ['visit_count',        '訪問回数',              'ユーザーの累計訪問（セッション）回数。リピーターの指標。'],
  ['total_intent_score', '累計インテントスコア',  'ユーザーの全セッションを通じた購買意欲スコアの合計。'],
  ['user_temperature',   'ユーザー温度',          '累計インテントスコアに基づくユーザーの温度感（COLD / WARM / HOT）。'],
]

// ── IG 接頭辞ユーティリティ ────────────────────────────────────────
const IG_LABEL_PREFIXES: Record<string, string> = {
  'ig_account_insight_fact': 'アカウント',
  'ig_media_insight_feed':   'フィード',
  'ig_media_insight_reels':  'リール',
  'ig_media_insight_story':  'ストーリー',
}
const IG_SEP = '：'

/** Instagram サービス KPI 用の派生指標（日次アカウント値から算出。id は fetch-metrics と一致） */
const IG_ACCOUNT_FORMULA_KPIS: MetricCard[] = [
  {
    id: 'ig_account_insight_fact@formula:kpi_home_rate_proxy',
    label: 'ホーム率（目安）',
    category: 'KPI（算出）',
    fieldRef: 'ig_account_insight_fact@formula:kpi_home_rate_proxy',
    description:
      '日次の「プロフィール閲覧数 ÷ 閲覧数（フォロワー内訳）」を % で表示（投稿ごとのホーム÷フォロワービューに近い目安）。月平均 50% 以上を目安にする場合は目標値に 50 を設定。',
  },
  {
    id: 'ig_account_insight_fact@formula:kpi_save_rate',
    label: '保存率',
    category: 'KPI（算出）',
    fieldRef: 'ig_account_insight_fact@formula:kpi_save_rate',
    description: '保存数 ÷ リーチ（日次、%）。各投稿の保存率の月平均 2% 以上を目安にする場合は目標値に 2 を設定。',
  },
  {
    id: 'ig_account_insight_fact@formula:kpi_profile_access_rate',
    label: 'プロフィールアクセス率',
    category: 'KPI（算出）',
    fieldRef: 'ig_account_insight_fact@formula:kpi_profile_access_rate',
    description: 'プロフィール閲覧数 ÷ リーチ（日次、%）。月平均 2% 以上を目安にする場合は目標値に 2 を設定。',
  },
  {
    id: 'ig_account_insight_fact@formula:kpi_follow_rate_30d',
    label: 'フォロー率（期間合算）',
    category: 'KPI（算出）',
    fieldRef: 'ig_account_insight_fact@formula:kpi_follow_rate_30d',
    description:
      '指定期間のフォロワー純増（日次 follower_count の期末−期首）÷ 同一期間のプロフィール閲覧合計（%）。単一期間（例: 直近30日1本）のときのみ値が入ります。月平均 5% 以上を目安にする場合は目標値に 5 を設定。',
  },
  {
    id: 'ig_account_insight_fact@formula:kpi_link_click_rate_30d',
    label: 'リンククリック率（期間合算）',
    category: 'KPI（算出）',
    fieldRef: 'ig_account_insight_fact@formula:kpi_link_click_rate_30d',
    description:
      '指定期間のプロフィールリンクタップ合計 ÷ プロフィール閲覧合計（%）。単一期間のときのみ値が入ります。月平均 5% 以上を目安にする場合は目標値に 5 を設定。',
  },
]

/**
 * テンプレートに保存済みのラベルへ IG 接頭辞を付与する。
 * metricRef（"テーブル名.フィールド名" 形式）でカテゴリを判定し、
 * 未付与のときだけ接頭辞を追加する。IG 以外の指標はそのまま返す。
 */
export function resolveIGLabel(metricRef: string, storedLabel: string): string {
  const table  = metricRef.split('.')[0]
  const prefix = IG_LABEL_PREFIXES[table]
  if (!prefix) return storedLabel
  const full = prefix + IG_SEP
  if (storedLabel.startsWith(full)) return storedLabel // 二重付与防止
  return full + storedLabel
}

/** 売上サービス: sales_days + sales_hourly_slots を日付で集約した仮想テーブル sales_rollup */
const SALES_ROLLUP: [string, string, string][] = [
  ['total_amount_with_tax', '売上（税込）', '当日・当該締めの全時間帯の税込合計。'],
  ['total_amount_without_tax', '売上（税抜）', '当日・当該締めの全時間帯の税抜合計。'],
  ['slot_count', '時間帯行数', '登録されている時間帯（子行）の件数。'],
  ['order_count', '注文件数', '当該営業日に紐づく時間帯へぶら下がる注文の件数。'],
  ['rest_break_slot_count', '休憩枠数', '休憩としてマークされた時間帯行の件数。'],
]

export function getMetricCatalog(serviceType: string): MetricCard[] {
  switch (serviceType) {
    case 'instagram': return [
      ...IG_ACCOUNT.map(([f,l,d]) => card('ig_account_insight_fact',  f, `アカウント${IG_SEP}${l}`, 'アカウントインサイト', d)),
      ...IG_ACCOUNT_FORMULA_KPIS,
      ...IG_FEED   .map(([f,l,d]) => card('ig_media_insight_feed',     f, `フィード${IG_SEP}${l}`,   'フィード投稿',         d)),
      ...IG_REELS  .map(([f,l,d]) => card('ig_media_insight_reels',    f, `リール${IG_SEP}${l}`,     'リール投稿',           d)),
      ...IG_STORY  .map(([f,l,d]) => card('ig_media_insight_story',    f, `ストーリー${IG_SEP}${l}`, 'ストーリーズ',         d)),
    ]
    case 'gbp': return [
      ...GBP_PERF  .map(([f,l,d]) => card('gbp_performance_daily',     f, l, 'パフォーマンス', d)),
      ...GBP_SEARCH_KW.map(([f,l,d]) => card('gbp_search_keyword_monthly', f, l, '検索キーワード（月次）', d)),
      ...GBP_REVIEW.map(([f,l,d]) => card('gbp_reviews',               f, l, 'クチコミ',       d)),
    ]
    case 'line': return [
      ...LINE_FRIENDS .map(([f,l,d]) => card('line_oam_friends_daily',   f, l, '友だち数',         d)),
      ...LINE_ATTR    .map(([f,l,d]) => card('line_oam_friends_attr',    f, l, '友だち属性',       d)),
      ...LINE_SHOPCARD.map(([f,l,d]) => card('line_oam_shopcard_status', f, l, 'ショップカード',   d)),
      ...LINE_POINT   .map(([f,l,d]) => card('line_oam_shopcard_point',  f, l, 'ポイント分布',     d)),
      ...LINE_TXN     .map(([f,l,d]) => card('line_oam_rewardcard_txns', f, l, 'トランザクション', d)),
    ]
    case 'lp': return [
      ...LP_METRICS    .map(([f,l,d]) => card('metric_summaries',  f, l, 'KPI集計',       d)),
      ...LP_SESSION    .map(([f,l,d]) => card('lp_sessions',       f, l, 'セッション',     d)),
      ...LP_PAGE_VIEW  .map(([f,l,d]) => card('lp_page_views',     f, l, 'ページビュー',   d)),
      ...LP_EVENT      .map(([f,l,d]) => card('lp_event_logs',     f, l, 'イベント',       d)),
      ...LP_USER       .map(([f,l,d]) => card('lp_users',          f, l, 'ユーザー',       d)),
    ]
    case 'sales': return [
      ...SALES_ROLLUP.map(([f, l, d]) => card('sales_rollup', f, l, '売上（日次集計）', d)),
    ]
    default: return []
  }
}

# Instagram Graph API — 本リポジトリで取得しているメトリクス一覧

このドキュメントは **`src/lib/instagram/client.ts`** およびバッチ（**`insight-collector`** / **`story-insight-collector`** / **`media-collector`** / アカウント同期）から実際に呼ばれている **Instagram（Meta）Graph API** を整理したものです。  
公式の厳密な定義は [Instagram Platform の Insights リファレンス](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) および [IG User Insights](https://developers.facebook.com/docs/instagram-platform/insights) を参照してください。

---

## 用語の整理（混乱しやすい点）

### 「フィード × プロフィール訪問数」（サマリー等の `ig_media_insight_feed.profile_visits`）

- **意味のイメージ**: メディアインサイトの **`profile_visits`** は、その **メディア（ここではフィード投稿）に帰属する**プロフィール閲覧の指標です。多くの解釈では **「その投稿経由でプロフィールが開かれた回数（行動の帰属）」** に近いですが、**Meta が公開する定義文に完全準拠する説明は公式ドキュメントに従ってください**。
- **集計単位**: **投稿（メディア）別**。アカウント全体の「その日の訪問者数」とは別物です。
- **時間粒度**: 本実装では **`GET /{media-id}/insights` に `period=lifetime` のみ** を付与しています。  
  → **「その投稿について、日ごとのプロフィール訪問者数」** を API で取る構成には **していません**。バッチ実行時点の **累計（ライフタイム）値のスナップショット** が `ig_media_insight_fact` に入ります（`snapshot_at` 単位で履歴が残る）。

### アカウント全体の「その日のプロフィール閲覧」

- Meta のアカウントインサイトには **`profile_views`**（プロフィール閲覧）などの日次メトリクスが存在し得ますが、**現行の `insight-collector` が `getAccountInsightsTotalValueExtended` で列挙しているメトリクス文字列には `profile_views` が含まれていません**。
- ダッシュボードの `/api/analytics` は既定で `profile_views` を読みに行くため、**収集していない場合はデータが空になり得ます**。必要なら `getAccountInsightsTotalValueExtended` のメトリクス列に追加する必要があります。

### ストーリー指標の二重保存

- **メディア汎用バッチ**（`insight-collector`）: 直近30日投稿を対象に `ig_media_insight_fact` へ保存。
- **ストーリー専用バッチ**（`story-insight-collector`）: 直近24時間のストーリーを **`ig_story_insight_fact`** に **`fetched_at` を時単位で丸めたスナップショット** として保存。  
  分析・グラフ用途で「時間軸の細かさ」が異なる点に注意してください。

---

## 一覧（API名・メトリクス名・内容・備考）

表の **API名** は実装で使っているベース URL（`graph.facebook.com` または `graph.instagram.com`）＋パス表現です。`{ig-user-id}` は Instagram ビジネス用 **IG User ID**、`{media-id}` は **メディア ID** です。

### A. IG User ノード（Insights 以外）

| API名 | メトリクス名（フィールド） | メトリクスの内容 | 備考 |
|--------|---------------------------|------------------|------|
| `GET /{ig-user-id}`（`graph.facebook.com`、通常 `fields=followers_count,...`） | `followers_count` | フォロワー数（プロフィール上のカウント） | **`insight-collector`** で `metric_code=follower_count` として **日次スナップ** を `ig_account_insight_fact` に保存。Insights API ではなく **User ノード**から取得。 |
| 同上 | `follows_count` | フォロー中アカウント数 | **アカウント同期**（`getProfileForSync` / `getProfileCounts` 経由）でプロフィール情報として利用。インサイト事業指標ではない。 |
| 同上 | `media_count` | メディア件数 | 同上。 |
| `GET /{ig-user-id}`（`fields=business_discovery.username(...){...}`） | `followers_count` 等 | Business Discovery 経由のカウント | **アカウント同期**で利用。`graph.instagram.com` モードでは取得しない。 |

### B. メディア一覧（指標ではないが Graph 取得）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/media` | （投稿フィールド） | `id`, `caption`, `media_type`, `media_product_type`, `permalink`, `timestamp` 等 | **`media-collector`**。インサイト数値ではない。 |

### C. メディアインサイト `GET /{media-id}/insights`

共通: **`period=lifetime`**。メトリクス名は API レスポンスの `name` をそのまま `ig_media_insight_fact.metric_code` に保存（ストーリー専用テーブルは後述 D）。

#### C-1. フィード（`media_product_type=FEED` として `getMediaInsights(..., 'FEED')`）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights` | `views` | コンテンツの閲覧（再生）に近い総回数系 | v22+ で `impressions` の代替として利用方針。 **ライフタイム累計のスナップショット**。 |
| 同上 | `reach` | ユニークアカウントへのリーチ | 同上。 |
| 同上 | `likes` | いいね数 | 同上。 |
| 同上 | `comments` | コメント数 | 同上。 |
| 同上 | `shares` | シェア数 | 同上。 |
| 同上 | `saved` | 保存数 | 同上。 |
| 同上 | `profile_visits` | プロフィールへの訪問（当該メディアに帰属） | **投稿別・lifetime**。日次推移は未取得。 |
| 同上 | `follows` | フォロー（当該メディアに帰属） | 同上。 |
| 同上 | `total_interactions` | インタラクション合計 | 同上。 |

#### C-2. リール（`REELS`）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights` | `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions` | フィードと同種の意味（リール文脈） | 同上 **lifetime**。 |
| 同上 | `ig_reels_video_view_total_time` | リールの総再生時間（ミリ秒） | 同上。 |
| 同上 | `ig_reels_avg_watch_time` | 平均視聴時間（ミリ秒） | 同上。 |

#### C-3. 動画（`VIDEO` ※ API 上は動画投稿向けのセット）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights` | `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions` | 動画投稿向けの一般的インサイト | **`profile_visits` / `follows` はこの型ではリクエストに含めていない**（`client.ts` の `VIDEO` 用メトリクス列挙による）。 |

#### C-4. ストーリー（`STORY`）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights` | `views`, `reach` | 閲覧数・リーチ | **lifetime** ＋ **`story-insight-collector`** では **`ig_story_insight_fact`** にも同系列を **時刻丸めスナップショット** で保存。 |
| 同上 | `replies` | DM 返信 | 同上。 |
| ~~同上~~ | ~~`taps_forward` / `taps_back` / `exits`~~ | （旧） | **Graph API v22+** では `GET /{media-id}/insights` の **複数 metric クエリに含められない**（`#100`）。 |

#### C-5. ストーリー `navigation`（breakdown）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights?metric=navigation&breakdown=story_navigation_action_type&period=lifetime` | `navigation_{action}` | 例: `navigation_tap_forward` — 公式 `navigation` の内訳 | `action` は API の次元値を **小文字化**して `metric_code` に保存。 |
| 同上（アプリ側の複写） | `taps_forward`, `taps_back`, `exits` | 次へ／前へ／離脱 | breakdown の `tap_forward` / `tap_back` / `tap_exit` を **従来の `metric_code` にも upsert** し、一覧 UI や `mergeLatestStoryInsightsIntoPostList` との互換を維持。 |

#### C-6. メディア `profile_activity`（breakdown）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{media-id}/insights?metric=profile_activity&breakdown=action_type&period=lifetime` | `profile_activity_{action}` | プロフィール上の行動タイプ別（例: メール、通話、Web 等） | `action` は API の `action_type` を **小文字化**。**FEED / REELS / STORY / VIDEO** で取得試行。値は **lifetime 系のスナップショット**。 |

---

### D. アカウントインサイト `GET /{ig-user-id}/insights`

保存先は主に **`ig_account_insight_fact`**（`metric_code`, `period_code`, `value_date`, `dimension_code`, `dimension_value`）。

#### D-1. 日次タイムシリーズ（`period=day`、単一レンジ）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/insights?metric=reach&period=day&since&until` | `reach` | 日次リーチ | **`getAccountInsightsTimeSeries`**。レスポンスの `values[].end_time` から **前日付け**に変換して `value_date` に保存する実装。 |

#### D-2. 日次 total_value（**1 日ずつ** `since=until=その日` で呼び出し）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/insights?metric=<複数>&metric_type=total_value&period=day&since&until` | `views` | 日次閲覧数（総回数系） | **`getAccountInsightsTotalValueExtended`**。Meta の仕様上 **複数日レンジの total_value が空**になり得るため、**1 日単位ループ**で取得。 |
| 同上 | `replies` | 日次返信数 | 同上。 |
| 同上 | `profile_links_taps` | プロフィールリンクのタップ | 同上。 |
| 同上 | `follows_and_unfollows` | フォロー／アンフォロー | 同上。 |
| 同上 | `reposts` | リポスト | 同上。 |
| 同上 | `accounts_engaged` | エンゲージしたアカウント数 | 同上。 |
| 同上 | `total_interactions` | インタラクション合計 | 同上。 |
| 同上 | `likes` / `comments` / `shares` / `saves` | 各エンゲージメント | 同上。 |

※ **`profile_views`（プロフィール閲覧・日次）は上記列挙に含まれていない**（UI 既定クエリとのズレに注意）。

#### D-3. 日次 breakdown（`metric_type=total_value` + `breakdown`）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/insights` + `breakdown=media_product_type` | `reach` / `views` | フィード / リール / ストーリー等の表面別の内訳 | ディメンション値は `ig_account_insight_fact.dimension_value` に格納。 |
| 同上 + `breakdown=follow_type` | `reach` | フォロワー / 非フォロワー別 | 同上。 |
| 同上 + `breakdown=follower_type` | `views` | フォロワー / 非フォロワー別 | 同上。 |

#### D-4. デモグラフィック（`period=lifetime` + `timeframe`）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/insights` | `engaged_audience_demographics` | エンゲージしたユーザーの属性分布 | `breakdown=country|age|gender|city`。**`timeframe=last_90_days`**。`value_date` にはバッチのウィンドウ終端日を使用。 |
| 同上 | `follower_demographics` | フォロワー属性分布 | 同上。 |

#### D-5. `online_followers`

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /{ig-user-id}/insights?metric=online_followers&metric_type=time_series&period=day&since&until` | `online_followers` | オンラインに近いフォロワー推定 | アカウントにより **取得不可のことがある**。日次 `values` を `value_date` に展開。 |

---

### E. その他（トークン・ログイン）

| API名 | メトリクス名 | メトリクスの内容 | 備考 |
|--------|-------------|------------------|------|
| `GET /me`（`graph.instagram.com` のみ） | `id`, `username`, `media_count` 等 | ログイン主体の確認 | **Instagram Login** 利用時。フォロワー数は取得しない。 |
| `GET /oauth/access_token` | — | 長期トークン更新 | メトリクスではない。 |

---

## 保存先マッピング（クイックリファレンス）

| データ | 主テーブル | 主キー・粒度の目安 |
|--------|------------|-------------------|
| メディア一般インサイト | `ig_media_insight_fact` | `media_id` + `metric_code` + `period_code` + **`snapshot_at`** |
| ストーリー（専用バッチ） | `ig_story_insight_fact` | `media_id` + `metric_code` + **`fetched_at`（時単位丸め）** |
| アカウントインサイト | `ig_account_insight_fact` | `account_id` + `metric_code` + `period_code` + `value_date` + (`dimension_code`,`dimension_value`) |

---

## 更新履歴

- リポジトリの実装（`src/lib/instagram/client.ts`、バッチ）に基づき一覧化。API の定義変更があった場合は Meta 公式ドキュメントを優先し、本ファイルのメトリクス列挙は `client.ts` と整合するよう更新してください。

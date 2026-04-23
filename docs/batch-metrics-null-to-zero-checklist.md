# バッチ成功経路でのメトリクス代入チェックリスト（null → 0 改修前調査用）

一次取得バッチで「API 等から値が取れたのに DB が null になる」箇所を洗い出し、改修時に **成功経路では 0 を INSERT**、**取得失敗時は null または行なし** とするためのチェックリスト。

## 実装状況（追記）

以下はコードに反映済み（共通: `src/lib/batch/numeric-coerce.ts`、Instagram 専用: `src/lib/batch/instagram-insight-metric-coerce.ts`）。

- Instagram `insight-collector` / `story-insight-collector`（`follower_count` はプロフィールに有限の `followers_count` があるときのみ upsert。欠損時は行を書かない）
- LINE OAM `line-oam-daily`
- GBP `gbp-daily`（`gbp_performance_daily` の数値列）
- `weather-sync` / `external-data`（天気取得成功時の数値列。未取得日は従来どおり null）
- Google Ads `sync-service`（CTR・CPC micros・quality_score を含む日次・マスター数値）

未着手の例: `project_metrics_aggregate` のキャッシュ方針、`kpi-calc` の派生 null。

## 凡例

| 記号 | 意味 |
|------|------|
| ☐ 要確認 | 「0 にすべき成功応答」が null / 欠損になり得るため、仕様・API・CSV を確認 |
| ☑ おそらく問題なし | 既に 0 寄せや常に number になっている |
| ☐ 設計判断 | null のままが正な可能性があり、要件（0 INSERT）と矛盾し得る |

**成功経路**: 該当 upsert に到達するまでに例外で落ちておらず、HTTP/API が意図どおり完了している区間。Instagram はレート制限でループを `break` した先は失敗寄りとして扱ってよい。

---

## Instagram — `src/app/api/batch/insight-collector/route.ts`

**成功経路の目安**: アカウントごとのメディアループで `getMediaInsights` まで到達し、内側の `catch` に入らない。アカウントインサイトは該当 `try` ブロック内。

| 状態 | テーブル | 列 / 論理名 | 代入元（成功経路） | 参照 |
|------|----------|---------------|-------------------|------|
| ☐ 要確認 | `ig_media_insight_fact` | `value`（メトリクス本線） | `values[0].value` / `value` / `total_value.value` がすべて無いと `undefined` のまま upsert | `insight-collector/route.ts` 212–223 行付近 |
| ☐ 要確認 | `ig_media_insight_fact` | `value`（`navigation_*`） | `typeof r.value === 'number' ? r.value : null` → 文字列数値・オブジェクトは null | 249–258 行付近 |
| ☐ 要確認 | `ig_media_insight_fact` | `value`（legacy navigation） | 同上 | 260–267 行付近 |
| ☐ 要確認 | `ig_media_insight_fact` | `value`（`profile_activity_*`） | 同上 | 304–313 行付近 |
| ☐ 要確認 | `ig_account_insight_fact` | `value`（breakdown） | `typeof r.value === 'number' ? r.value : null` | 375–387 行付近 |
| ☐ 要確認 | `ig_account_insight_fact` | `value`（時系列 `period_code=day`） | `v.value` をそのまま（型が number でないと未検証） | 414–426 行付近 |
| ☑ おそらく問題なし | `ig_account_insight_fact` | `value`（total_value 日次） | `typeof val !== 'number'` のとき continue（行を書かない） | 459–470 行付近 |
| ☐ 要確認 | `ig_account_insight_fact` | `value`（`online_followers`） | `scalar == null` で continue（0 は入るがオブジェクト合計が 0 だと null 扱い） | 609–634 行付近 |
| ☑ おそらく問題なし | `ig_account_insight_fact` | `value`（`follower_count`） | `followers_count` が number のときのみ upsert | 683–696 行付近 |

---

## Instagram — `src/app/api/batch/story-insight-collector/route.ts`

**成功経路の目安**: `getMediaInsights` 成功・レート制限未満。navigation は `navRes != null` かつレート制限未満。

| 状態 | テーブル | 列 | 代入元 | 参照 |
|------|----------|-----|--------|------|
| ☐ 要確認 | `ig_story_insight_fact` | `value`（本線） | `toStoryInsightBigintValue(raw)` — `typeof v !== 'number'` なら null（例: 文字列 `"0"`） | `story-insight-collector/route.ts` 157–168 行、`toStoryInsightBigintValue` 14–21 行 |
| ☐ 要確認 | `ig_story_insight_fact` | `value`（`navigation_*` / legacy） | `toStoryInsightBigintValue(r.value)` 同上 | 205–230 行付近 |

---

## LP / MA — `src/app/api/batch/lp-aggregate/route.ts`

**成功経路の目安**: サイト×レンジの内側 `try` が成功。

| 状態 | テーブル | 列 | 代入元 | 参照 |
|------|----------|-----|--------|------|
| ☑ おそらく問題なし | `metric_summaries` | `value` | `sessionCount` / `userCount` / `avgStaySeconds` / `hotRate`（計算結果は数値、未設定は 0 寄せ） | 104–120 行付近 |

補足: ファイル先頭コメントの `ranking_summaries` 更新は、現コードでは upsert が見当たらないため別途整合確認。

---

## GA4 — `src/app/api/batch/ga4-collector/route.ts`

**成功経路の目安**: 連携ごとの `try` 内で `throwOnDbError` が通った行。

| 状態 | テーブル | 主な数値列 | 代入 | 参照 |
|------|----------|------------|------|------|
| ☑ おそらく問題なし | `ga4_daily_metrics` | `sessions`, `total_users`, … | `num(s.metrics[i])`（未定義は 0） | 167–190 行付近 |
| ☑ おそらく問題なし | `ga4_page_metrics` | `screen_page_views`, … | `intMetric` / `num` | 198–217 行付近 |
| ☑ おそらく問題なし | `ga4_traffic_sources` 等 | 各種 count / revenue | `num(row.metrics[…])` | 225–306 行付近 |

注意: `fetchDailySummary` が 0 行のときは `ga4_daily_metrics` の upsert がスキップされる（「null」ではなく「行なし」）。163–193 行付近。

---

## Clarity — `src/app/api/batch/clarity-collector/route.ts` / `src/lib/clarity/client.ts`

**成功経路の目安**: 連携ごとの `try` 内、`fetchClarity*` が throw しない。

| 状態 | テーブル | 数値列 | 代入 | 参照 |
|------|----------|--------|------|------|
| ☑ おそらく問題なし | `clarity_daily_metrics` | 各種 count / 平均 | `daily.*`（`client.ts` の `num()` で文字列も 0 フォールバック） | `clarity-collector/route.ts` 154–171 行、`clarity/client.ts` 50–56 行 |
| ☑ おそらく問題なし | `clarity_page_metrics` | `sessions`, `rage_clicks`, … | `p.sessionCount` 等 | 178–196 行付近 |
| ☑ おそらく問題なし | `clarity_device_metrics` | `sessions`, `total_users` | `d.sessionCount` 等 | 203–216 行付近 |

---

## GBP — `src/app/api/batch/gbp-daily/route.ts`

**成功経路の目安**: `fetchPerformance` が 1 行以上、`rows.length > 0` のときの performance upsert。

| 状態 | テーブル | 列 | 代入 | 参照 |
|------|----------|-----|------|------|
| ☐ 要確認 | `gbp_performance_daily` | `business_impressions_*` 等（11 指標） | `row.metrics[col] ?? null`（キー欠落は null） | `gbp-daily/route.ts` 209–215 行、`lib/gbp/constants.ts` の `METRIC_TO_COLUMN` |
| ☑ おそらく問題なし | `gbp_search_keyword_monthly` | `impressions`, `threshold` | `it.impressions`, `it.threshold` | 251–258 行付近 |

レビューの `star_rating` 等はメトリクス「件数」要件の主対象外でよいことが多い。

---

## LINE OAM — `src/app/api/batch/line-oam-daily/route.ts`

**成功経路の目安**: 各 `*Res.ok` かつ CSV パース後の `upsertData` 構築。

| 状態 | テーブル | 列 | 代入 | 参照 |
|------|----------|-----|------|------|
| ☐ 要確認 | `line_oam_friends_daily` | `contacts`, `target_reaches`, `blocks` | `r.xxx ? Number(...) : null`（空文字は falsy → null） | 161–169 行付近 |
| ☐ 要確認 | `line_oam_friends_attr` | `percentage` | `r.percentage ? Number(...) : null`（`"0"` は truthy で 0、空欄は null） | 188–194 行付近 |
| ☐ 要確認 | `line_oam_shopcard_status` | `valid_cards` 等 | 同上パターン | 222–234 行付近 |
| ☐ 要確認 | `line_oam_shopcard_point` | `users` | `r.users ? Number(r.users) : null` | 257–264 行付近 |
| ☐ 要確認 | `line_oam_rewardcard_txns` | `points` | `r['Points'] ? Number(...) : null` | 290–298 行付近 |

---

## Google 広告 — `src/lib/google-ads/sync-service.ts`（エントリ: `src/app/api/batch/google-ads-daily/route.ts`）

**成功経路の目安**: `searchStream` が行を返し、ID と `date` が揃った行が daily 配列に入る。

| 状態 | テーブル | 列 | 代入 | 参照 |
|------|----------|-----|------|------|
| ☑ おそらく問題なし | `google_ads_campaign_daily` 等 | `impressions`, `clicks`, `cost_micros`, … | `Number(metrics?.xxx ?? 0)` | `sync-service.ts` 198–209 行付近（キャンペーン／広告グループ／キーワード日次も同パターン） |
| ☐ 設計判断 | 同上 | `ctr`, `average_cpc_micros` | `metrics?.ctr != null ? Number : null` | 207–208, 309–310, 421–422 行付近 |
| ☐ 設計判断 | キーワードマスター / 日次 | `quality_score` | API 欠損で null | 405, 423 行付近 |

---

## 外部データ（天気・祝日）

### `src/app/api/batch/weather-sync/route.ts`

**成功経路の目安**: プロジェクト単位の `try` が成功し、`fetchWeatherForecast` が例外を投げない。

| 状態 | テーブル | 列 | 代入 | 参照 |
|------|----------|-----|------|------|
| ☐ 要確認 | `project_external_daily` | `temperature_max` 等 | `weather?.x ?? null`（その日キーが map に無いと null） | 119–132 行付近 |

### `src/app/api/batch/external-data/route.ts`

**成功経路の目安**: プロジェクト単位の `try` が成功。

| 状態 | テーブル | 列 | 代入 | 参照 |
|------|----------|-----|------|------|
| ☐ 要確認 | `project_external_daily` | 同上 | 緯度経度なしは初期オブジェクトの null のまま upsert | 94–124 行付近 |

---

## 参考（今回の「0 INSERT」の対象外になりやすいもの）

| ファイル | 理由 |
|----------|------|
| `src/app/api/batch/project-metrics-aggregate/route.ts` | 意図的に `value === null` をキャッシュから除外。一次バッチの 0 寄せとセットでないと意味が変わる。 |
| `src/app/api/batch/kpi-calc/route.ts` | 派生計算。一次取得の方針確定後に追随確認。 |

---

## 実装着手の推奨順

1. Instagram（`insight-collector` / `story-insight-collector`）
2. LINE OAM（`truthy ? Number : null` の列挙が容易）
3. GBP 日次パフォーマンス（`METRIC_TO_COLUMN` 全列が同一パターン）
4. 天気（欠測と 0℃・0mm の区別を仕様で決める）
5. Google Ads（集計列は 0 寄せ済み。CTR / CPC / quality_score のみ判断）

---

## 関連ドキュメント

- ダッシュボード上のジョブ一覧・説明: `src/app/(dashboard)/batch/page.tsx` の `JOB_META` / `BATCH_ENDPOINTS`

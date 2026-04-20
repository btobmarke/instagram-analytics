/**
 * 投稿1件の ig_media_insight_fact 取得上限。
 * 1スナップショットあたり複数 metric 行があるため、数千件だと昇順の先頭だけが返り
 * グラフ上「7日以降にスナップが無い」ように見える。
 */
export const IG_MEDIA_INSIGHT_FACT_MAX_ROWS = 100_000

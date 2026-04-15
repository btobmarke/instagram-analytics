
# TODO 管理

> このファイルで開発タスクを一元管理する。
> ステータス: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了 / `[-]` 保留・スキップ

---

## 売上分析機能

### DB / マイグレーション
- [x] `023_sales_analytics.sql` 作成（5テーブル + service_type 制約更新）
  - [x] `product_master`（商品マスタ）
  - [x] `sales_records`（売上データ・日次・締め単位）
  - [x] `orders`（注文データ）
  - [x] `order_items`（注文明細）
  - [x] `product_daily_outputs`（商品出数）
- [ ] Supabase に `023` マイグレーションを適用する

### API
- [x] `GET/POST/DELETE /api/services/[serviceId]/sales/records` — 売上データ
- [x] `GET/POST /api/services/[serviceId]/sales/records/[recordId]/orders` — 注文データ
- [x] `GET/POST/DELETE /api/services/[serviceId]/sales/orders/[orderId]/items` — 注文明細
- [x] `GET/POST/PATCH/DELETE /api/services/[serviceId]/sales/products` — 商品マスタ
- [x] `GET/POST/DELETE /api/services/[serviceId]/sales/daily-outputs` — 商品出数

### UI ページ
- [x] ダッシュボード（`/sales/dashboard`）— KPIカード・売上履歴一覧
- [x] 売上登録（`/sales/records`）— 売上データのフォーム入力・削除
- [x] 商品マスタ（`/sales/products`）— 商品の追加・編集・有効化/無効化
- [x] サービス登録モーダルに「💰 売上分析」タイプを追加
- [x] プロジェクトページにラベル・ルーティングを追加

### 未実装（データ登録方法 保留中）
> 注文データ・注文明細・商品出数のデータ登録方法を決めてから実装する。
> 候補: CSV アップロード / 手動フォーム / POS API 連携

- [-] 注文データ・注文明細の登録 UI（登録方法が決まり次第）
- [-] 商品出数の登録 UI（登録方法が決まり次第）
- [ ] 登録方法の方針決定（CSV / 手動 / API 連携）

### 今後の拡張（優先度低）
- [ ] 他サービス（Instagram・Google広告等）との比較グラフ
- [ ] 原価率・粗利の自動計算表示
- [ ] 商品別売上ランキング表示
- [ ] 売上データの CSV エクスポート
- [ ] 期間別比較（前月比・前年比）

---

## その他 既知の TODO

### 全般
- [ ] TypeScript エラーの解消（既存コードの pre-existing エラー）
  - `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/lp/page.tsx`
  - `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/page.tsx`
  - `src/app/api/accounts/[id]/sync/route.ts`
  - `src/app/api/batch/insight-collector/route.ts`
  - `src/lib/ai/resolve-ai-model.ts`
  - `src/lib/instagram/client.ts`

### バッチ管理（手動実行）
- [ ] バッチ管理画面（`src/app/(dashboard)/batch/page.tsx`）の手動実行リストと、`src/app/api/batch/**/route.ts` の実装の突合せを定期的に行う
  - [x] `hourly_account_insight_collector` は実装上 `insight-collector` 内で収集しているため、手動実行は `/api/batch/insight-collector` に紐づける（UI 側の `BATCH_ENDPOINTS` / `BATCH_GROUPS` へ追加済み）
  - [x] `weekly_ai_analysis` の手動実行ボタンを追加（`/api/batch/ai-analysis` に紐づけ、UI 側の `BATCH_ENDPOINTS` / `BATCH_GROUPS` へ追加済み）
  - [ ] `JOB_META` にあるが `src/app/api/batch/**` に見当たらないジョブ（例: `monthly_ai_analysis`, `daily_token_refresh`）は、実装するか `JOB_META` から外すか整理する

---

## メモ・決定事項

### 売上分析 DB 設計の決定事項（2026-04-11）
| 項目 | 決定内容 |
|---|---|
| 商品価格 | 変動あり → 注文明細・商品出数に**価格スナップショット**を保持 |
| 割引の構造 | 注文レベル割引（`order_discount_amount`）と明細レベル割引（`discount_amount`）を分離 |
| 複数締め | `session_label`（自由入力）＋ `session_start_time` / `session_end_time` で管理 |
| データソース共存 | `data_source = 'pos'` or `'manual'` フラグで集計時の優先データを識別 |
| service_id 紐付け | 売上データ・商品マスタはすべて `services.id` に紐付く（プロジェクトIDではない） |

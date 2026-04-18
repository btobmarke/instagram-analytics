# Instagram 提案資料（クライアント向け）— 実装計画

## 1. 目的

- 指定した期間の **Instagram データのみ** を材料に、**構成案（目次相当）→ 確認・調整 → 本文（Markdown）→ PDF ダウンロード** までを同一フローで提供する。
- **入口**: プロジェクト → サービス（Instagram）→ **AI分析** 画面。

## 2. スコープ（フェーズ1）

| # | 内容 |
|---|------|
| 1 | 分析期間の指定（直近7日 / 30日 / 90日 / 任意日付） |
| 2 | サーバが期間内データを集計し **コンテキストダイジェスト** を生成 |
| 3 | LLM で **構成案 JSON**（タイトル・章・要点）を生成 |
| 4 | 画面上で構成案の確認・**章タイトル・並びの編集**（JSON をそのまま保持） |
| 5 | **チャット**（ストリーミング）で構成・トーンの相談（任意） |
| 6 | **提案本文（Markdown）** を生成しプレビュー、**html2pdf** で PDF ダウンロード |

### スコープ外（フェーズ2以降）

- PPTX 出力・テンプレ穴埋め（別方針で検討。下記「今後の検討」参照）。
- DB に提案履歴を永続化（必要なら `instagram_proposal_*` テーブルを後付け）。

## 3. データソース

- `ig_accounts`（ユーザー名）
- `ig_account_insight_fact`（期間内の日次指標の合計／代表値）
- `ig_media` + `ig_media_insight_fact`（期間内投稿の上位・主要指標）
- `instagram_service_kpis`（既存の `buildInstagramServiceKpiPromptBlock` でテキスト化）

## 4. API 設計

| メソッド | パス | 役割 |
|----------|------|------|
| `POST` | `/api/services/[serviceId]/instagram/proposal/outline` | 期間指定 → コンテキスト生成 → **構成案 JSON** |
| `POST` | `/api/services/[serviceId]/instagram/proposal/document` | 確定構成 + ダイジェスト + 任意チャット要約 → **Markdown 全文** |
| `POST` | `/api/services/[serviceId]/instagram/proposal/chat` | 構成確定後の **相談チャット**（UIMessage ストリーム） |

共通: `resolveInstagramAccountIdForService`、`getAiModelIdForServiceId`、認証必須。

## 5. UI（AI分析ページ）

- 既存の「週次／月次 AI レポート」ブロックの **下** に **「クライアント向け提案資料」** カードを追加。
- コンポーネント: `InstagramProposalPanel`（期間 → 構成案 → 編集 → チャット → 本文 → PDF）。

## 6. 技術メモ

- 構成案は **JSON** で受け取り **Zod** で検証。失敗時は 1 回リトライまたはエラー表示。
- 本文は **Markdown**。PDF は既存の `downloadHtmlAsPdf`（クライアント）で印刷用 DOM から出力。
- トークン削減のため、LLM には **要約済みダイジェスト** を渡す（生の巨大 JSON は避ける）。

## 7. 実装ファイル一覧

- `docs/instagram-proposal-materials-plan.md` — 本書
- `src/lib/instagram/proposal-context.ts` — 期間集計・ダイジェスト文字列
- `src/lib/instagram/proposal-schemas.ts` — Zod スキーマ（構成案）
- `src/app/api/services/[serviceId]/instagram/proposal/outline/route.ts`
- `src/app/api/services/[serviceId]/instagram/proposal/document/route.ts`
- `src/app/api/services/[serviceId]/instagram/proposal/chat/route.ts`
- `src/components/instagram/InstagramProposalPanel.tsx`
- `src/app/(dashboard)/projects/[projectId]/services/[serviceId]/instagram/ai/page.tsx` — パネル埋め込み

## 8. 構造化スライド（案B・MVP 実装済み）

- **テンプレ v1**（コード内）: 表紙 `cover` → 指標テーブル `kpi` → 各章 `section`（構成案の `sections` と 1:1）
- **API**
  - `POST /api/services/[serviceId]/instagram/proposal-deck/fill` — 構成案 + 要約 + 期間 → LLM が JSON（`proposalDeckContentSchema`）
  - `POST /api/services/[serviceId]/instagram/proposal-deck/export/pptx` — JSON → **pptxgenjs** で PPTX（`slideIndices` で部分エクスポート可）
  - `GET /api/services/[serviceId]/instagram/proposal-deck/template` — テンプレ説明・例
- **UI**: Instagram → AI分析 →「構造化スライド（案B・PPTX）」カード（編集・全体/選択 PPTX ダウンロード）
- **旧来の Markdown + PDF** フローはそのまま併存

### 案A（HTML プレビュー・画像ベース PPTX）

- **テンプレ**: `classic` / `magazine`（`src/lib/instagram/proposal-html/templates.ts`）。ページ種別ごとに **レイアウトワイヤー ID** と **パーツ**（表紙・KPI 表・章本文）を対応付け。
- **データ**: 案B と同じ `proposalDeck` JSON（親で **1 回**「スライドデータを生成」）。
- **プレビュー**: `ProposalHtmlSlides`（16:9 の HTML スライド）。
- **PPTX**: クライアントで **html2canvas** → PNG base64 を `POST .../proposal-html/export/pptx` に送り、サーバで **pptxgenjs** が各枚を画像スライドとして貼付（ベクター変換ではない）。
- **任意**: 追加 CSS、`.html` の参考プレビュー（iframe `sandbox`・スクリプト非実行）、`GET .../proposal-html/templates` でメタ取得。

---

## 9. 実装状況（フェーズ1）

| 項目 | 状態 |
|------|------|
| 期間指定（7/30/90日・任意日付） | 実装済（`InstagramProposalPanel`） |
| データ要約 `buildInstagramProposalDigest` | 実装済 |
| 構成案 API `POST .../proposal/outline` | 実装済 |
| 構成の画面編集 | 実装済（タイトル・章・目的・要点） |
| 相談チャット API `POST .../proposal/chat` | 実装済（非ストリーミング JSON） |
| 本文 API `POST .../proposal/document` | 実装済（Markdown） |
| PDF ダウンロード | 実装済（既存 `downloadHtmlAsPdf`） |
| 入口 UI | Instagram → AI分析（`instagram/ai/page.tsx`） |

---

*作成: 実装に先立ち、仕様の共有用。実装後にセクション9を追記。*

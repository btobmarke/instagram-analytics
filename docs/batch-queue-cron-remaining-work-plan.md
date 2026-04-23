# バッチ（Cron グループ化・キュー・手動実行・履歴）残課題 — 実装計画

本書は、**Cron 時間帯グループ化（案A）以降に残る課題**に対する**実装計画**である。コードではなく、フェーズ・成果物・依存・リスク・完了条件を整理する。

**現状（本書執筆時点の前提）**

- `vercel.json` は **7 本の Cron** → `POST /api/batch/cron-groups/{g2|g3|…}`（オーケストレータ）
- オーケストレータは **該当 UTC ティックのバッチだけ**既存 `POST /api/batch/{slug}` を **並列 `fetch`** で起動
- 各バッチは従来どおり **全体処理**（プロジェクト単位分割・メッセージキューは**未導入**）
- 認証は `validateBatchRequest`（`CRON_SECRET` / `BATCH_SECRET`）

### 実装済み（2026-02 時点のスナップショット）

| 領域 | 内容 |
|------|------|
| Phase 0（一部） | `cron-groups` の構造化ログ・`notifyBatchError`；`eslint.config.mjs` を FlatCompat 化；`npm run lint:batch` でキュー関連のみ lint |
| キュー基盤 | **`batch_job_queue` + `dequeue_batch_jobs`**（`063_*`）、**`service_id` / `account_id` 列**（`064_*`）、**`POST /api/internal/batch-queue-worker`**（Cron `limit=15`）。**`batch_proxy` は廃止**（`dispatchQueueJobInProcess` で lib 直叩き or 合成 `NextRequest`） |
| Cron グループ | 既定 **`enqueueCronBatchJobsForSlug`**（`BATCH_CRON_GROUPS_USE_QUEUE=false` で従来の直接 `fetch`） |
| 代表ジョブ | **`weather_sync`** は DB 内完結。**その他 Cron 対象スラッグ**は **専用 `job_name` + `payload`** で分割 enqueue（プロジェクト / サービス / アカウント / LP サイト / GBP サイト単位） |
| 手動・履歴 | **`POST /api/batch/weather-sync/enqueue`**、**`GET /api/projects/:id/batch-logs`**、`batch_job_logs` 拡張 |
| ドキュメント | `docs/batch-queue-runbook.md`、`docs/adr/001-batch-queue-postgres.md` |

### 未完了（この計画書の残り）

- ~~**`batch_proxy` を廃し**各ジョブを **DB 内ハンドラのみ**に寄せる（HTTP 二重起動の排除）~~ **実装済み**（残: 巨大ルートの **完全 lib 化**で合成 `NextRequest` も不要にする）
- **外部キュー（Inngest/QStash）**への差し替えは未着手（ADR は Postgres 第一版）
- **全リポジトリの `npm run lint` クリーン**（既存ファイルの大量 violation）
- **DB staging・ジョブ別 concurrency の本番チューニング**（ワーカーは `limit` のみ）
- （除外）**`gbp_batch_runs` / `line_oam_batch_runs` の run 持ち方**はユーザー指示により本計画のスコープ外

---

## 1. ゴール（この計画で「完了」とみなす状態）

| ID | ゴール |
|----|--------|
| G1 | **キュー（B案）**により、バッチ実行が **プロジェクト（または定義したシャード）単位**で並列化・再試行可能 |
| G2 | **手動実行**: **バッチ単位（全プロジェクト）** と **プロジェクト単位** を API（＋必要なら UI）で提供。**グループ単位の手動は不要**（設計固定） |
| G3 | **実行履歴**を **プロジェクト単位**で成功/失敗・期間・メタ情報を参照可能（一覧・フィルタ） |
| G4 | **DB・外部 API**負荷を **concurrency・バッチサイズ・ロック方針**で制御し、運用指標（失敗率・DLQ）を追える |
| G5 | **Cron オーケストレータ**の挙動（並列度・タイムアウト・失敗通知）が本番要件を満たす |

---

## 2. ロードマップ全体（フェーズ）

依存の大枠は **0 → 1 → 2** がクリティカルパス。**3** は 1 と並行可。**4** は継続的改善。

| Phase | 名称 | 概要 |
|-------|------|------|
| **0** | 観測・安全運用 | オーケストレータ・子バッチの失敗可視化、並列起動の負荷確認、lint/CI |
| **1** | キュー基盤 | 製品選定、アダプタ、Worker 契約、シークレット・本番設定 |
| **2** | ジョブ単位移行 | 代表ジョブから **1 メッセージ = (job_name, project_id)** へ分割・既存ロジックの抽出 |
| **3** | 手動・履歴・認可 | enqueue API、RLS/ロール、`batch_job_logs` 拡張、UI |
| **4** | 全ジョブ移行・最適化 | 残ジョブ、DB staging、concurrency チューニング、Cron の一本化検討 |

---

## 3. Phase 0 — 観測・安全運用（短期）

**目的**: キュー導入前に、現行 Cron グループ化のリスクを顕在化し、計測可能にする。

| ID | タスク | 成果物 / 完了条件 |
|----|--------|-------------------|
| 0.1 | オーケストレータの **構造化ログ**（`groupId`, `due`, 各 `slug` の status、所要時間） | ログで 1 ティックの成否が追える |
| 0.2 | **子バッチ失敗時のアラート**（既存 `notifyBatchError` パターンに合わせるか、グループ用に集約） | 運用が気づける |
| 0.3 | **並列起動の負荷レビュー**（G2/G3/G4 で同時に動くジョブの DB・外部 API の重なり） | 文書化。問題あれば Phase 0.4 |
| 0.4 | （任意）同一ティックを **順次 `fetch`** に変更、または **ジョブ間ディレイ** | 負荷が許容範囲になる |
| 0.5 | **`npm run lint` / CI** の修復（`eslint-config-next` 解決エラー等） | CI で lint が通る |
| 0.6 | ドキュメント: **ローカルでオーケストレータを試す条件**（`NEXT_PUBLIC_APP_URL` or `VERCEL_URL` + シークレット） | `docs/` または README 追記 |

**完了の定義**: 本番で 1〜2 週間、Cron グループの失敗・タイムアウトが把握でき、明らかなボトルネックに対処方針が付いている。

---

## 4. Phase 1 — キュー基盤（B案）

**目的**: 「プロジェクト単位ジョブ」を永続キューに載せ、再試行・並列度のノブを持つ。

### 4.1 製品選定（既に方針がある場合は ADR 1 枚）

| 観点 | メモ |
|------|------|
| 候補 | **Inngest**（concurrency・ファンアウト・UI） / **QStash**（軽量 HTTP・メッセージ課金）など |
| 必須機能 | 再試行、失敗隔離（DLQ 相当）、**concurrency**（グローバル / ジョブ種別）、Vercel からの publish |
| 成果物 | **ADR**: 選定理由、料金の見積り式、撤退時の代替 |

### 4.2 アプリケーション境界

| ID | タスク | 成果物 |
|----|--------|--------|
| 1.1 | **`QueueAdapter` インターフェース**（`enqueue(payload)` / 型定義） | 実装差し替え可能 |
| 1.2 | **メッセージスキーマ**（`schema_version`, `job_name`, `project_id`, `trigger`, `correlation_id`, `idempotency_key`, …） | バージョン管理方針 |
| 1.3 | **Worker エンドポイント**（例: `POST /api/internal/batch-worker`）キュー署名 or 共有シークレット | ブラウザから直叩き不可 |
| 1.4 | **環境変数・Vercel 設定**一覧 | セットアップ手順 |
| 1.5 | **ダッシュボード運用**（キュー UI、DLQ 監視） | Runbook に記載 |

**完了の定義**: スタブジョブ 1 種類が **Cron → enqueue → Worker → ログ**まで通る（本番は feature flag で限定でも可）。

---

## 5. Phase 2 — ジョブ単位移行（コア）

**目的**: 既存 `POST /api/batch/{slug}` の **「全件ループ」**を **プロジェクト（またはシャード）単位**に分割し、キューで消化する。

### 5.1 共通リファクタ

| ID | タスク | 注意 |
|----|--------|------|
| 2.1 | 各ジョブの **「対象 project_id（または service_id）列挙」**を共通関数化 | オーケストレータと手動「全件」が同じ一覧を使う |
| 2.2 | ジョブ本体を **`runJobForProject(job_name, project_id, ctx)`** に抽出 | 既存 Route は薄いラッパに段階移行 |
| 2.3 | **冪等性キー**（例: `job_name + project_id + 日付粒度`）をキューと DB で定義 | Cron 二重起動・手動連打 |

### 5.2 移行順序（例）

1. **副作用が読み取り中心・ロックが少ない**ジョブから  
2. **大量 UPSERT** が集中するジョブは **concurrency 低め**＋ **DB 対策（Phase 4）** とセット

**完了の定義（フェーズ内）**: 優先ジョブ N 本が **キュー経由のみ**で運用でき、旧「全体一括」パスは feature flag OFF。

### 5.3 Cron との接続

| 経路 | 役割 |
|------|------|
| 現行 | `cron-groups` → 各 `slug` の **HTTP 起動** |
| 移行後（目標） | `cron-groups` または **単一オーケストレータ**が **`enqueue` のみ**（重い処理は Worker） |

**タスク 2.4**: オーケストレータの **`maxDuration` と子ジョブの関係**を整理（親は enqueue のみに寄せるとタイムアウト問題が減る）。

---

## 6. Phase 3 — 手動実行・履歴・認可

**目的**: ユーザー要件どおり **バッチ単位**・**プロジェクト単位**（グループ手動はなし）を満たす。

### 6.1 API 設計（概念）

| エンドポイント（例） | 内容 |
|----------------------|------|
| `POST /api/batch/{job_name}/enqueue` | body: `{ project_id }` → メッセージ 1 件 |
| 同上 + `scope: "all_active_projects"` | 管理者等のみ。`correlation_id` を発行し N 件 enqueue |
| 認可 | **プロジェクトメンバー** / **組織管理者** などを RLS・サーバ検証で明示 |

### 6.2 `batch_job_logs`（または相当）

| ID | タスク |
|----|--------|
| 3.1 | カラム追加: `project_id`, `trigger`, `correlation_id`, `idempotency_key`, `queue_message_id`（必要なら） |
| 3.2 | インデックス: `(project_id, started_at desc)` 等 |
| 3.3 | 既存 **`closeStaleRunningBatchLogs`** との整合（ジョブ名・キー） |
| 3.4 | **`/api/batch/status`** 拡張 or プロジェクト配下の API でフィルタ |

### 6.3 UI（任意・フェーズ分割可）

- プロジェクト設定: 「このバッチを実行」「直近の実行ログ」
- 管理者: 全プロジェクト enqueue（確認モーダル・上限）

**完了の定義**: 手動 2 種が API で利用でき、プロジェクト画面（または status API）で **成否が追える**。

---

## 7. Phase 4 — 全ジョブ移行・DB・コスト最適化

**目的**: 残ジョブの移行、同一テーブルへの集中書き込み対策、コストの見える化。

| ID | タスク |
|----|--------|
| 4.1 | 全 `vercel.json` / `cron-groups` 対象ジョブの **キュー化完了**（`line-messaging-*` 等、Cron 外ジョブは別表で管理） |
| 4.2 | **ジョブ別 concurrency**・**プロジェクト単位直列**（必要ジョブのみ）の設定 |
| 4.3 | DB: **staging テーブル**、バルク INSERT → merge、**UPSERT キー見直し**、デッドロック回避（更新順統一） |
| 4.4 | 外部 API: **レート制限**・バックオフ・**日次クォータ**の監視 |
| 4.5 | コスト: **invocations・メッセージ数・DB 接続**のダッシュボード化 |

**完了の定義**: 旧「全体一括 HTTP バッチ」が削除または緊急用のみ。運用 Runbook が更新されている。

---

## 8. リスクと緩和（横断）

| リスク | 緩和 |
|--------|------|
| キュー投入スパイク | **チャンク enqueue**、concurrency、スケジュール分散 |
| 同一行への競合 UPSERT | キー設計、staging、ジョブ直列化 |
| シークレット漏洩 | Worker は内部認証のみ、ローテーション手順 |
| 部分移行中の二重実行 | feature flag、`idempotency_key`、短い移行手順書 |

---

## 9. マイルストーン案（目安）

| マイルストーン | 内容 |
|----------------|------|
| M1 | Phase 0 完了 + lint/CI 正常化 |
| M2 | Phase 1 完了（スタブジョブ E2E） |
| M3 | Phase 2 で優先ジョブ 1〜3 本を本番キュー運用 |
| M4 | Phase 3 API + ログスキーマ + 最小 UI |
| M5 | Phase 4 全ジョブ + DB チューニングレビュー |

※日程はチーム速度に依存するため、**週次で M1→M2** のように見直す。

---

## 10. 参照（リポジトリ内）

| パス | 内容 |
|------|------|
| `vercel.json` | Cron 7 本 → `cron-groups/*` |
| `src/lib/batch/cron-groups.ts` | グループ定義・`getDueBatchSlugs` |
| `src/app/api/batch/cron-groups/[groupId]/route.ts` | オーケストレータ |
| `src/lib/utils/batch-auth.ts` | Bearer 検証 |
| `src/lib/batch/close-stale-running-batch-logs.ts` | running 滞留対策 |
| `src/app/api/batch/status/route.ts` | 現状のログ参照（拡張ポイント） |

---

## 11. 本書のメンテナンス

- キュー製品を決定したら **§4.1 に ADR リンク**を追記する。
- ジョブ移行が進んだら **§5.2 の順序表**を実態に合わせて更新する。

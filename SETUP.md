# Instagram Analytics — セットアップガイド

## 構成

```
instagram-analytics/
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # 認証済みページ群
│   │   │   ├── layout.tsx        # サイドバー共通レイアウト
│   │   │   ├── accounts/         # アカウント管理
│   │   │   ├── posts/            # 投稿一覧・詳細
│   │   │   ├── analytics/        # アカウント分析
│   │   │   ├── batch/            # バッチ管理
│   │   │   └── settings/         # 各種設定
│   │   ├── auth/login/           # ログイン
│   │   └── api/                  # APIルート
│   ├── lib/
│   │   ├── supabase/             # Supabase クライアント
│   │   ├── instagram/            # Instagram Graph API
│   │   └── claude/               # Claude AI クライアント
│   └── types/                    # 型定義
├── supabase/migrations/
│   ├── 001_initial_schema.sql    # 全テーブル作成
│   └── 002_kpi_master_seed.sql   # KPIマスタ・初期データ
├── vercel.json                   # Vercel Cron 設定
└── .env.local.example            # 環境変数テンプレート
```

---

## Step 1: Supabase プロジェクト作成

1. [Supabase](https://supabase.com) にサインアップ・ログイン
2. 「New Project」でプロジェクト作成
3. **SQL Editor** を開き、以下を順番に実行：
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_kpi_master_seed.sql`
4. **Settings → API → API Keys** からキーを取得：
  **新UI（2025年〜）の場合：**

  | 環境変数                            | 取得場所                                      |
  | ------------------------------- | ----------------------------------------- |
  | `NEXT_PUBLIC_SUPABASE_URL`      | Settings → General → Project URL          |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Publishable key**（`sb_publishable_...`） |
  | `SUPABASE_SERVICE_ROLE_KEY`     | **Secret key**（`sb_secret_...`）           |

   **旧UI / Legacy タブの場合：**

  | 環境変数                            | 取得場所                        |
  | ------------------------------- | --------------------------- |
  | `NEXT_PUBLIC_SUPABASE_URL`      | Project URL                 |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` キー（`eyJ...`）         |
  | `SUPABASE_SERVICE_ROLE_KEY`     | `service_role` キー（`eyJ...`） |

  > どちらの形式でも `@supabase/supabase-js` v2.47以降は対応しています。
5. **Authentication → Users** で最初のユーザーを作成（メール＋パスワード）

---

## Step 2: Meta/Instagram Graph API 設定

1. [Meta for Developers](https://developers.facebook.com/apps/) でアプリ作成
2. **Instagram Graph API** を追加
3. ビジネス/クリエイターアカウントの長期アクセストークンを取得
  - トークン取得ツール: [https://developers.facebook.com/tools/explorer/](https://developers.facebook.com/tools/explorer/)
  - 必要スコープ: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`
4. アクセストークンを**60日間有効な長期トークン**に交換：
  ```
   GET https://graph.instagram.com/access_token
     ?grant_type=ig_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &access_token={short-lived-token}
  ```

---

## Step 3: 環境変数設定

`.env.local.example` を `.env.local` にコピーし、各値を設定：

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
META_APP_ID=1234567890
META_APP_SECRET=abcdef...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=任意の秘密文字列
ENCRYPTION_KEY=openssl rand -hex 32 で生成した64文字の16進数
```

---

## Step 4: ローカル開発起動

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開くと、ログイン画面にリダイレクトされます。

---

## Step 5: Vercel デプロイ

1. GitHub にリポジトリを作成しプッシュ
2. [Vercel](https://vercel.com) でリポジトリをインポート
3. **Environment Variables** に `.env.local` の全変数を登録
4. `**CRON_SECRET`** は必ず設定（バッチAPIの認証に使用）
5. デプロイ完了後、`vercel.json` の Cron が自動的に有効化される

---

## Step 6: 初回セットアップ（アプリ内）

1. ログイン後、**アカウント管理** → 「アカウントを追加」
  - Instagram アカウントID（数値）
  - ユーザー名（@なし）
  - アクセストークン
2. **設定 → 戦略設定** でアカウント方針を記入
3. **設定 → KPI設定** で目標値を設定
4. **バッチ管理** → 手動実行で初回データ収集
  - 「投稿一覧同期」を実行
  - 「毎時インサイト収集」を実行

---

## バッチスケジュール（Vercel Cron）


| ジョブ     | スケジュール    | 説明                    |
| ------- | --------- | --------------------- |
| 投稿一覧同期  | 毎日 JST 0:00・12:00（UTC 3:00/15:00） | 全投稿をInstagram APIから取得 |
| インサイト収集 | 毎時 0分     | 各投稿のインサイト指標を収集        |
| KPI計算   | 毎時 45分    | KPIを計算してDBに保存         |
| 週次AI分析  | 毎週月曜 6:00 | 週次レポートを自動生成           |


> **Note**: Vercel Cron は Hobby プランでは最小間隔が1日1回です。
> Pro プランで毎時実行が可能です。

---

## 手動バッチ実行

バッチ管理ページから手動実行が可能です。
CRON_SECRET を入力してボタンをクリックするだけです。

---

## よくある質問

**Q: アクセストークンの有効期限は？**
A: 長期トークンは60日間有効です。毎日3時に自動更新バッチが実行されます。

**Q: AI分析が実行されない**
A: `ANTHROPIC_API_KEY` が正しく設定されているか確認してください。

**Q: インサイトが表示されない**
A: Instagram Graph APIはビジネス/クリエイターアカウントのみ対応。
また、投稿後24時間経過しないとインサイトが取得できない場合があります。
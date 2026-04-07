-- Migration 012: gbp_sites にアカウント名カラムを追加
-- レビューAPI (v4) は accounts/{accountId}/locations/{locationId}/reviews 形式が必要なため

ALTER TABLE gbp_sites ADD COLUMN IF NOT EXISTS gbp_account_name TEXT;

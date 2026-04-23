-- サービス単位・アカウント単位のキュージョブ用
ALTER TABLE batch_job_queue
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE CASCADE;

ALTER TABLE batch_job_queue
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ig_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_batch_job_queue_service_pending
  ON batch_job_queue(service_id, status, run_after)
  WHERE service_id IS NOT NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS idx_batch_job_queue_account_pending
  ON batch_job_queue(account_id, status, run_after)
  WHERE account_id IS NOT NULL AND status = 'pending';

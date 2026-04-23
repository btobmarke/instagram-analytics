-- バッチキュー（DB-backed）と batch_job_logs の拡張
-- アプリは service_role のみでキューを操作する想定

-- ---------------------------------------------------------------------------
-- batch_job_logs 拡張
-- ---------------------------------------------------------------------------
ALTER TABLE batch_job_logs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE batch_job_logs
  ADD COLUMN IF NOT EXISTS trigger_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'batch_job_logs_trigger_source_check'
  ) THEN
    ALTER TABLE batch_job_logs
      ADD CONSTRAINT batch_job_logs_trigger_source_check
      CHECK (trigger_source IS NULL OR trigger_source IN ('cron', 'manual', 'queue_worker', 'api', 'internal'));
  END IF;
END $$;

ALTER TABLE batch_job_logs
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

ALTER TABLE batch_job_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE batch_job_logs
  ADD COLUMN IF NOT EXISTS job_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_batch_job_logs_project_started
  ON batch_job_logs(project_id, started_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batch_job_logs_correlation
  ON batch_job_logs(correlation_id, started_at DESC)
  WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- batch_job_queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_job_queue (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name           TEXT NOT NULL,
  project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key    TEXT NOT NULL,
  correlation_id     UUID,
  trigger_source     TEXT NOT NULL DEFAULT 'cron'
    CHECK (trigger_source IN ('cron', 'manual', 'queue_worker', 'api', 'internal')),
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  run_after          TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at          TIMESTAMPTZ,
  locked_by          TEXT,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_job_queue_idempotency_active
  ON batch_job_queue (idempotency_key)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_batch_job_queue_pending
  ON batch_job_queue (status, run_after, created_at)
  WHERE status = 'pending';

ALTER TABLE batch_job_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'batch_job_queue' AND policyname = 'service_role_all_batch_job_queue'
  ) THEN
    CREATE POLICY service_role_all_batch_job_queue
      ON batch_job_queue FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 同時実行中の重複 idempotency を防ぐ（pending / processing のみ一意）
COMMENT ON TABLE batch_job_queue IS 'Project-scoped batch jobs; consumed by queue worker (service_role)';

-- ---------------------------------------------------------------------------
-- dequeue: FOR UPDATE SKIP LOCKED で N 件を processing に遷移して返す
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dequeue_batch_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF batch_job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE batch_job_queue q
  SET
    status = 'processing',
    locked_at = now(),
    attempts = q.attempts + 1,
    updated_at = now()
  FROM (
    SELECT id
    FROM batch_job_queue
    WHERE status = 'pending'
      AND run_after <= now()
      AND attempts < max_attempts
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  ) picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION dequeue_batch_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dequeue_batch_jobs(integer) TO service_role;

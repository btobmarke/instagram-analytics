/** DB: batch_job_queue の 1 行（dequeue_batch_jobs の戻り） */
export type BatchJobQueueRow = {
  id: string
  job_name: string
  project_id: string | null
  service_id?: string | null
  account_id?: string | null
  payload: Record<string, unknown>
  idempotency_key: string
  correlation_id: string | null
  trigger_source: string
  status: string
  attempts: number
  max_attempts: number
  run_after: string
  locked_at: string | null
  locked_by: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export const QUEUE_JOB_NAMES = ['weather_sync'] as const
export type QueueJobName = (typeof QUEUE_JOB_NAMES)[number]

export function isQueueJobName(s: string): s is QueueJobName {
  return (QUEUE_JOB_NAMES as readonly string[]).includes(s)
}

/** URL slug（/api/batch/weather-sync）→ キュー job_name */
export function batchSlugToQueueJobName(slug: string): QueueJobName | null {
  if (slug === 'weather-sync') return 'weather_sync'
  return null
}

export function queueJobNameToSlug(name: QueueJobName): string {
  if (name === 'weather_sync') return 'weather-sync'
  return name
}

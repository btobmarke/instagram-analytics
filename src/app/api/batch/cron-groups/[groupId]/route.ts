export const dynamic = 'force-dynamic'
/** 同一ティック内は並列キック。個別バッチは自ルートの maxDuration に依存 */
export const maxDuration = 300

import { NextResponse } from 'next/server'
import {
  CRON_GROUP_IDS,
  type CronGroupId,
  getCronGroupDefinition,
  getDueBatchSlugs,
  isCronGroupId,
} from '@/lib/batch/cron-groups'
import { logBatchAuthFailure, validateBatchRequest } from '@/lib/utils/batch-auth'
import { notifyBatchError } from '@/lib/batch-notify'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { enqueueCronBatchJobsForSlug } from '@/lib/batch/batch-enqueue-by-slug'

function getDeploymentOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (explicit) return explicit
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`
  return null
}

function getBatchAuthHeader(): string | null {
  const t = process.env.CRON_SECRET || process.env.BATCH_SECRET
  if (!t) return null
  return `Bearer ${t}`
}

function cronGroupsUseQueue(): boolean {
  return process.env.BATCH_CRON_GROUPS_USE_QUEUE !== 'false'
}

/**
 * POST /api/batch/cron-groups/:groupId
 * 時間帯グループ Cron 用。今回の UTC 時刻に該当するバッチだけを順に POST で起動する。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<NextResponse> {
  if (!validateBatchRequest(request)) {
    logBatchAuthFailure('cron-groups/[groupId]', request)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { groupId: raw } = await context.params
  if (!isCronGroupId(raw)) {
    return NextResponse.json(
      { error: 'Unknown group', allowed: [...CRON_GROUP_IDS] },
      { status: 400 }
    )
  }
  const groupId = raw as CronGroupId
  const def = getCronGroupDefinition(groupId)
  const now = new Date()
  const due = getDueBatchSlugs(groupId, now)

  const origin = getDeploymentOrigin()
  const auth = getBatchAuthHeader()

  if (!origin || !auth) {
    console.error('[cron-groups] missing origin or CRON_SECRET/BATCH_SECRET', {
      hasOrigin: Boolean(origin),
      hasAuth: Boolean(auth),
    })
    return NextResponse.json(
      {
        error: 'Server misconfiguration',
        hint: 'Set NEXT_PUBLIC_APP_URL or VERCEL_URL and CRON_SECRET or BATCH_SECRET',
      },
      { status: 500 }
    )
  }

  if (due.length === 0) {
    console.info('[cron-groups] tick', {
      event: 'cron_group_tick',
      group: groupId,
      label: def.label,
      now: now.toISOString(),
      due: [],
    })
    return NextResponse.json({
      ok: true,
      group: groupId,
      label: def.label,
      now: now.toISOString(),
      due: [],
      message: 'No batch matched this cron tick (expected for sparse schedules)',
    })
  }

  const tickStarted = Date.now()
  console.info('[cron-groups] tick', {
    event: 'cron_group_tick',
    group: groupId,
    label: def.label,
    now: now.toISOString(),
    due,
    parallel: true,
  })

  const useQueue = cronGroupsUseQueue()

  const settled = await Promise.all(
    due.map(async (slug) => {
      if (useQueue) {
        try {
          const admin = createSupabaseAdminClient()
          const q = await enqueueCronBatchJobsForSlug(admin, slug, 'cron')
          const ok = q.failed === 0
          if (!ok) {
            console.warn('[cron-groups] enqueue incomplete', {
              group: groupId,
              slug,
              enqueued: q.enqueued,
              skipped: q.skipped,
              failed: q.failed,
            })
          }
          return {
            slug,
            ok,
            status: ok ? 200 : 500,
            mode: 'queue' as const,
            enqueue: q,
          } as const
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          console.error('[cron-groups] enqueue failed', { group: groupId, slug, message }, e)
          return {
            slug,
            ok: false,
            status: null as number | null,
            error: message,
            mode: 'queue' as const,
          } as const
        }
      }

      const url = `${origin}/api/batch/${slug}`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
        const ok = res.ok
        if (!ok) {
          const text = await res.text().catch(() => '')
          console.warn('[cron-groups] batch returned non-OK', {
            group: groupId,
            slug,
            status: res.status,
            bodyPreview: text.slice(0, 500),
          })
        }
        return { slug, ok, status: res.status, mode: 'fetch' as const } as const
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('[cron-groups] batch fetch failed', { group: groupId, slug, message }, e)
        return { slug, ok: false, status: null as number | null, error: message, mode: 'fetch' as const } as const
      }
    })
  )

  const results = [...settled]
  const durationMs = Date.now() - tickStarted

  const failed = results.filter((r) => !r.ok)
  console.info('[cron-groups] tick_done', {
    event: 'cron_group_tick_done',
    group: groupId,
    duration_ms: durationMs,
    ok: failed.length === 0,
    results: results.map((r) => ({
      slug: r.slug,
      ok: r.ok,
      status: r.status,
      error: 'error' in r ? r.error : undefined,
    })),
  })

  if (failed.length > 0) {
    await notifyBatchError({
      jobName: `cron_group:${groupId}`,
      processed: results.length - failed.length,
      errorCount: failed.length,
      errors: failed.map((r) => ({
        error: `${r.slug}: ${'error' in r && r.error ? r.error : `HTTP ${r.status ?? '?'}`}`,
      })),
      executedAt: now,
    })
  }

  const allOk = results.every((r) => r.ok)
  return NextResponse.json(
    {
      ok: allOk,
      group: groupId,
      label: def.label,
      now: now.toISOString(),
      due,
      results,
      duration_ms: durationMs,
    },
    { status: allOk ? 200 : 207 }
  )
}

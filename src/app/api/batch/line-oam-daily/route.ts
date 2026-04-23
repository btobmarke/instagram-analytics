export const dynamic    = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decryptStorageState, buildCookieHeader, type LineOamSessionRecord } from '@/lib/line-oam/crypto'
import { notifyBatchError, notifyBatchSuccess } from '@/lib/batch-notify'
import {
  parseCsv,
  toYYYYMMDD, toYYYYMMDDDash, toUnixMs,
  parseLineDateTime,
  buildUrl,
} from '@/lib/line-oam/csv-parser'
import { csvCellNumberOrZero } from '@/lib/batch/numeric-coerce'

// GET: Vercel Cron 用 / POST: 手動実行用
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.BATCH_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '') ??
                 new URL(req.url).searchParams.get('secret') ?? ''
    if (auth !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runBatch()
}
export async function POST(req: NextRequest) { return GET(req) }

// ----------------------------------------------------------------
// バッチ本体
// ----------------------------------------------------------------
async function runBatch() {
  const admin = createSupabaseAdminClient()
  const startedAt = new Date()

  // JST 昨日を target_date とする
  // ※ toYYYYMMDD / toYYYYMMDDDash は内部で +9h するため、ここでは UTC の Date をそのまま渡す
  const nowJst      = new Date(Date.now() + 9 * 60 * 60 * 1000)  // JST 現在時刻（UTC内部値）
  const yesterdayJst = new Date(nowJst)
  yesterdayJst.setUTCDate(nowJst.getUTCDate() - 1)               // JST 昨日（UTC内部値）
  // 文字列は UTC の ISO slice で直接生成（二重変換を避ける）
  const targetDate    = yesterdayJst.toISOString().slice(0, 10)   // "YYYY-MM-DD"
  const targetDateYMD = targetDate.replace(/-/g, '')              // "YYYYMMDD"

  // batch_job_logs INSERT
  const { data: jobLog } = await admin.from('batch_job_logs').insert({
    job_name: 'line_oam_daily',
    status: 'running',
    records_processed: 0,
    records_failed: 0,
    started_at: startedAt.toISOString(),
  }).select().single()

  // バッチ実行レコード INSERT
  const { data: batchRun, error: batchInsertErr } = await admin
    .from('line_oam_batch_runs')
    .insert({ trigger: 'vercel_cron', target_date: targetDate, status: 'running' })
    .select('id').single()

  if (batchInsertErr || !batchRun) {
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        error_message: 'batch_run insert failed',
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    return NextResponse.json({ error: 'batch_run insert failed' }, { status: 500 })
  }
  const batchRunId = batchRun.id

  // URLテンプレートを取得
  const { data: templates } = await admin.from('line_oam_url_templates').select('*')
  const tplMap = Object.fromEntries((templates ?? []).map((t: { csv_type: string; url_template: string }) => [t.csv_type, t.url_template]))
  const baseUrl = tplMap['base_url'] ?? 'https://manager.line.biz'

  const errors: Array<{ clientId?: string; serviceId?: string; error: string }> = []
  let processedServices = 0

  try {
    // アクティブな LINE OAM サービス設定を全件取得（クライアント・プロジェクト情報も JOIN）
    const { data: configs } = await admin
      .from('line_oam_service_configs')
      .select(`
        id, bot_id,
        services!inner(id, project_id, projects!inner(client_id))
      `)
      .eq('is_active', true)

    if (!configs || configs.length === 0) {
      await finalize(admin, batchRunId, 'success', [], 0)
      await notifyBatchSuccess({
        jobName: 'line_oam_daily',
        processed: 0,
        executedAt: startedAt,
        lines: [`対象日: ${targetDate}`, 'アクティブな LINE OAM サービスがありません'],
      })
      return NextResponse.json({ success: true, processed: 0, message: 'No active LINE OAM services' })
    }

    for (const config of configs as Array<{
      id: string; bot_id: string
      services: { id: string; project_id: string; projects: { client_id: string } }
    }>) {
      const serviceId = config.services.id
      const clientId  = config.services.projects.client_id
      const botId     = config.bot_id

      // クライアントのセッションを取得
      const { data: session } = await admin
        .from('line_oam_sessions')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .single()

      if (!session) {
        errors.push({ clientId, serviceId, error: 'セッションが未登録または無効です' })
        continue
      }

      // storage_state を復号 → Cookie ヘッダー構築
      let cookieHeader: string
      try {
        const storageState = decryptStorageState(session as LineOamSessionRecord)
        cookieHeader = buildCookieHeader(storageState)

        // last_used_at 更新
        await admin.from('line_oam_sessions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', session.id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ clientId, serviceId, error: `セッション復号失敗: ${msg}` })
        continue
      }

      const fetchWithCookie = (url: string) => fetch(url, {
        headers: { Cookie: cookieHeader }
      })

      /** 401 を受け取ったらセッションを expired にマーク（一度だけ実行） */
      let sessionMarkedExpired = false
      const markSessionExpired = async () => {
        if (sessionMarkedExpired) return
        sessionMarkedExpired = true
        await admin.from('line_oam_sessions')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', session.id)
        console.warn(`[line-oam] session expired — marked as expired: client=${clientId} service=${serviceId}`)
      }

      try {
        // ---- 1. フレンド数 (contacts) ----
        const contactsUrl = buildUrl(tplMap['contacts'] ?? '', {
          base_url: baseUrl, bot_id: botId,
          from_yyyymmdd: targetDateYMD, to_yyyymmdd: targetDateYMD,
        })
        const contactsRes = await fetchWithCookie(contactsUrl)
        if (contactsRes.ok) {
          const rows = parseCsv(await contactsRes.text())
          const upsertData = rows
            .filter(r => r.date)
            .map(r => ({
              service_id:     serviceId,
              date:           `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`,
              contacts:       csvCellNumberOrZero(r.contacts),
              target_reaches: csvCellNumberOrZero(r.targetReaches),
              blocks:         csvCellNumberOrZero(r.blocks),
              collected_at:   new Date().toISOString(),
            }))
          if (upsertData.length > 0) {
            await admin.from('line_oam_friends_daily')
              .upsert(upsertData, { onConflict: 'service_id,date' })
          }
        } else {
          console.warn(`[line-oam] contacts ${contactsRes.status} for service=${serviceId}`)
          if (contactsRes.status === 401) await markSessionExpired()
          errors.push({ serviceId, error: `contacts HTTP ${contactsRes.status}` })
        }

        // ---- 2. フレンド属性 (friends_attr) ----
        const attrUrl = buildUrl(tplMap['friends_attr'] ?? '', {
          base_url: baseUrl, bot_id: botId,
        })
        const attrRes = await fetchWithCookie(attrUrl)
        if (attrRes.ok) {
          const rows = parseCsv(await attrRes.text())
          const upsertData = rows.map(r => ({
            service_id:  serviceId,
            date:        targetDate,
            gender:      r.gender ?? null,
            age:         r.age ?? null,
            percentage:  csvCellNumberOrZero(r.percentage),
            collected_at: new Date().toISOString(),
          }))
          if (upsertData.length > 0) {
            await admin.from('line_oam_friends_attr')
              .upsert(upsertData, { onConflict: 'service_id,date,gender,age' })
          }
        }

        // ---- リワードカードごとの処理 ----
        const { data: rewardcards } = await admin
          .from('line_oam_rewardcards')
          .select('*')
          .eq('service_id', serviceId)
          .eq('is_active', true)

        for (const card of rewardcards ?? []) {
          const rcId   = card.rewardcard_id as string
          const cardId = card.id as string

          // ---- 3. ショップカード・ステータス ----
          const statusUrl = buildUrl(tplMap['shopcard_status'] ?? '', {
            base_url: baseUrl, bot_id: botId, rewardcard_id: rcId, date_str: targetDate,
          })
          const statusRes = await fetchWithCookie(statusUrl)
          if (statusRes.ok) {
            const csvText = await statusRes.text()
            const rows = parseCsv(csvText)
            console.log(`[line-oam] shopcard_status card=${rcId} rows=${rows.length} sample=${JSON.stringify(rows[0] ?? {})}`)
            const upsertData = rows.map(r => ({
              line_rewardcard_id:      cardId,
              date:                    targetDate,
              name:                    r.name ?? '',
              valid_cards:             csvCellNumberOrZero(r.validCards),
              issued_cards:            csvCellNumberOrZero(r.issuedCards),
              store_visit_points:      csvCellNumberOrZero(r.storeVisitPoints),
              welcome_bonuses_awarded: csvCellNumberOrZero(r.WelcomeBonusesAwarded),
              expired_points:          csvCellNumberOrZero(r.expiredPoints),
              vouchers_awarded:        csvCellNumberOrZero(r.vouchersAwarded),
              vouchers_used:           csvCellNumberOrZero(r.vouchersUsed),
              deleted:                 r.deleted === 'true',
              collected_at:            new Date().toISOString(),
            }))
            if (upsertData.length > 0) {
              const { error: statusUpsertErr } = await admin.from('line_oam_shopcard_status')
                .upsert(upsertData, { onConflict: 'line_rewardcard_id,date,name' })
              if (statusUpsertErr) console.error(`[line-oam] shopcard_status upsert error:`, statusUpsertErr.message)
            }
          } else {
            const body = await statusRes.text()
            console.warn(`[line-oam] shopcard_status HTTP ${statusRes.status} card=${rcId} url=${statusUrl} body=${body.slice(0, 200)}`)
            if (statusRes.status === 401) await markSessionExpired()
            errors.push({ serviceId, error: `shopcard_status HTTP ${statusRes.status} card=${rcId}` })
          }

          // ---- 4. ショップカード・ポイント分布 ----
          const pointUrl = buildUrl(tplMap['shopcard_point'] ?? '', {
            base_url: baseUrl, bot_id: botId, rewardcard_id: rcId, date_str: targetDate,
          })
          const pointRes = await fetchWithCookie(pointUrl)
          if (pointRes.ok) {
            const csvText = await pointRes.text()
            const rows = parseCsv(csvText)
            console.log(`[line-oam] shopcard_point card=${rcId} rows=${rows.length} sample=${JSON.stringify(rows[0] ?? {})}`)
            const upsertData = rows
              .filter(r => r.point !== '' && r.point !== undefined)
              .map(r => ({
                line_rewardcard_id: cardId,
                date:               targetDate,
                point:              Number(r.point),
                users:              csvCellNumberOrZero(r.users),
                collected_at:       new Date().toISOString(),
              }))
            if (upsertData.length > 0) {
              const { error: pointUpsertErr } = await admin.from('line_oam_shopcard_point')
                .upsert(upsertData, { onConflict: 'line_rewardcard_id,date,point' })
              if (pointUpsertErr) console.error(`[line-oam] shopcard_point upsert error:`, pointUpsertErr.message)
            }
          } else {
            const body = await pointRes.text()
            console.warn(`[line-oam] shopcard_point HTTP ${pointRes.status} card=${rcId} url=${pointUrl} body=${body.slice(0, 200)}`)
            if (pointRes.status === 401) await markSessionExpired()
            errors.push({ serviceId, error: `shopcard_point HTTP ${pointRes.status} card=${rcId}` })
          }

          // ---- 5. リワードカード・ポイント取引履歴（全期間） ----
          const startDate = card.start_date
            ? new Date(`${card.start_date}T00:00:00+09:00`)
            : new Date('2020-01-01T00:00:00+09:00')
          const txnUrl = buildUrl(tplMap['rewardcard_txns'] ?? '', {
            base_url: baseUrl, bot_id: botId, rewardcard_id: rcId,
            from_ms: toUnixMs(startDate),
            to_ms:   toUnixMs(yesterdayJst),
          })
          const txnRes = await fetchWithCookie(txnUrl)
          if (txnRes.ok) {
            const rows = parseCsv(await txnRes.text())
            const upsertData = rows
              .filter(r => r['Date Time'] && r['Customer ID'])
              .map(r => ({
                line_rewardcard_id: cardId,
                txn_datetime:       parseLineDateTime(r['Date Time']),
                customer_id:        r['Customer ID'],
                point_type:         r['Point Type'] ?? null,
                points:             csvCellNumberOrZero(r['Points']),
                collected_at:       new Date().toISOString(),
              }))
            if (upsertData.length > 0) {
              // 大量データのため 500件ずつ分割してUPSERT
              for (let i = 0; i < upsertData.length; i += 500) {
                await admin.from('line_oam_rewardcard_txns')
                  .upsert(upsertData.slice(i, i + 500), { onConflict: 'line_rewardcard_id,txn_datetime,customer_id' })
              }
            }
          }
        }

        processedServices++
        console.log(`[line-oam-daily] service=${serviceId} (${botId}) done`)

      } catch (svcErr) {
        const msg = svcErr instanceof Error ? svcErr.message : String(svcErr)
        console.error(`[line-oam-daily] service=${serviceId} error:`, msg)
        errors.push({ clientId, serviceId, error: msg })
      }
    }
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal)
    console.error('[line-oam-daily] fatal error:', msg)
    await finalize(admin, batchRunId, 'failed', [{ error: msg }], processedServices)
    if (jobLog) {
      await admin.from('batch_job_logs').update({
        status: 'failed',
        records_processed: processedServices,
        records_failed: 1,
        error_message: msg,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      }).eq('id', jobLog.id)
    }
    await notifyBatchError({
      jobName: 'line_oam_daily',
      processed: processedServices,
      errorCount: 1,
      errors: [{ error: msg }],
      executedAt: startedAt,
    })
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  const status = errors.length === 0 ? 'success' : (processedServices > 0 ? 'partial' : 'failed')
  await finalize(admin, batchRunId, status, errors, processedServices)

  if (jobLog) {
    await admin.from('batch_job_logs').update({
      status,
      records_processed: processedServices,
      records_failed: errors.length,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
    }).eq('id', jobLog.id)
  }

  if (status !== 'success') {
    await notifyBatchError({
      jobName: 'line_oam_daily',
      processed: processedServices,
      errorCount: errors.length,
      errors,
      executedAt: startedAt,
    })
  } else {
    await notifyBatchSuccess({
      jobName: 'line_oam_daily',
      processed: processedServices,
      executedAt: startedAt,
      lines: [`対象日: ${targetDate}`],
    })
  }

  return NextResponse.json({
    success:    true,
    target_date: targetDate,
    processed:  processedServices,
    errors:     errors.length,
    status,
  })
}

async function finalize(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string, status: string, errors: unknown[], processed: number
) {
  await admin.from('line_oam_batch_runs').update({
    finished_at:   new Date().toISOString(),
    status,
    error_summary: errors.length > 0 ? { errors, processed } : null,
  }).eq('id', id)
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * GET /api/services/:serviceId/clarity?days=30
 *
 * clarity_daily_metrics / clarity_page_metrics / clarity_device_metrics を集計して返す
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 365)
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().split('T')[0]

  // ① 日次サマリー
  const { data: daily, error: dailyErr } = await supabase
    .from('clarity_daily_metrics')
    .select('*')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
    .order('report_date', { ascending: true })

  if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 })

  // ② ページ別（期間集計）
  const { data: pages, error: pagesErr } = await supabase
    .from('clarity_page_metrics')
    .select('page_url, sessions, total_users, scroll_depth_avg_pct, active_time_sec_avg, rage_clicks, dead_clicks, quick_backs, js_errors')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
    .order('sessions', { ascending: false })

  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 })

  // ページ別に集計（同一URLの複数日分をまとめる）
  const pageMap = new Map<string, {
    page_url: string
    sessions: number
    total_users: number
    scroll_depth_sum: number
    active_time_sum: number
    rage_clicks: number
    dead_clicks: number
    quick_backs: number
    js_errors: number
    count: number
  }>()

  for (const p of pages ?? []) {
    const existing = pageMap.get(p.page_url)
    if (existing) {
      existing.sessions += p.sessions
      existing.total_users += p.total_users
      existing.scroll_depth_sum += Number(p.scroll_depth_avg_pct)
      existing.active_time_sum += Number(p.active_time_sec_avg)
      existing.rage_clicks += p.rage_clicks
      existing.dead_clicks += p.dead_clicks
      existing.quick_backs += p.quick_backs
      existing.js_errors += p.js_errors
      existing.count += 1
    } else {
      pageMap.set(p.page_url, {
        page_url: p.page_url,
        sessions: p.sessions,
        total_users: p.total_users,
        scroll_depth_sum: Number(p.scroll_depth_avg_pct),
        active_time_sum: Number(p.active_time_sec_avg),
        rage_clicks: p.rage_clicks,
        dead_clicks: p.dead_clicks,
        quick_backs: p.quick_backs,
        js_errors: p.js_errors,
        count: 1,
      })
    }
  }

  const aggregatedPages = Array.from(pageMap.values())
    .map(p => ({
      page_url: p.page_url,
      sessions: p.sessions,
      total_users: p.total_users,
      scroll_depth_avg_pct: p.count > 0 ? Math.round((p.scroll_depth_sum / p.count) * 10) / 10 : 0,
      active_time_sec_avg: p.count > 0 ? Math.round((p.active_time_sum / p.count) * 10) / 10 : 0,
      rage_clicks: p.rage_clicks,
      dead_clicks: p.dead_clicks,
      quick_backs: p.quick_backs,
      js_errors: p.js_errors,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)

  // ③ デバイス別（期間集計）
  const { data: devices, error: devicesErr } = await supabase
    .from('clarity_device_metrics')
    .select('device_type, sessions, total_users')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)

  if (devicesErr) return NextResponse.json({ error: devicesErr.message }, { status: 500 })

  const deviceMap = new Map<string, { sessions: number; total_users: number }>()
  for (const d of devices ?? []) {
    const existing = deviceMap.get(d.device_type)
    if (existing) {
      existing.sessions += d.sessions
      existing.total_users += d.total_users
    } else {
      deviceMap.set(d.device_type, { sessions: d.sessions, total_users: d.total_users })
    }
  }
  const aggregatedDevices = Array.from(deviceMap.entries()).map(([device_type, v]) => ({
    device_type,
    sessions: v.sessions,
    total_users: v.total_users,
  }))

  return NextResponse.json({
    success: true,
    data: {
      days,
      since: sinceStr,
      daily: daily ?? [],
      pages: aggregatedPages,
      devices: aggregatedDevices,
    },
  })
}

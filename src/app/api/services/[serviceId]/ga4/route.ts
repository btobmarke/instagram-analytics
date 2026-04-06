export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * GET /api/services/:serviceId/ga4?days=30
 *
 * ga4_daily_metrics / ga4_page_metrics / ga4_traffic_sources /
 * ga4_device_metrics / ga4_geo_metrics / ga4_event_metrics を集計して返す
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
    .from('ga4_daily_metrics')
    .select('*')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
    .order('report_date', { ascending: true })
  if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 })

  // ② ページ別（期間集計・上位20件）
  const { data: pages, error: pagesErr } = await supabase
    .from('ga4_page_metrics')
    .select('page_path, page_title, screen_page_views, total_users, sessions, avg_time_on_page_sec, bounce_rate, entrances, exits, conversions')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 })

  const pageMap = new Map<string, {
    page_path: string; page_title: string | null
    screen_page_views: number; total_users: number; sessions: number
    time_sum: number; bounce_sum: number; entrances: number; exits: number
    conversions: number; count: number
  }>()
  for (const p of pages ?? []) {
    const ex = pageMap.get(p.page_path)
    if (ex) {
      ex.screen_page_views += p.screen_page_views
      ex.total_users       += p.total_users
      ex.sessions          += p.sessions
      ex.time_sum          += Number(p.avg_time_on_page_sec)
      ex.bounce_sum        += Number(p.bounce_rate)
      ex.entrances         += p.entrances
      ex.exits             += p.exits
      ex.conversions       += p.conversions
      ex.count             += 1
    } else {
      pageMap.set(p.page_path, {
        page_path: p.page_path, page_title: p.page_title,
        screen_page_views: p.screen_page_views, total_users: p.total_users,
        sessions: p.sessions,
        time_sum: Number(p.avg_time_on_page_sec), bounce_sum: Number(p.bounce_rate),
        entrances: p.entrances, exits: p.exits, conversions: p.conversions, count: 1,
      })
    }
  }
  const aggregatedPages = Array.from(pageMap.values())
    .map(p => ({
      page_path: p.page_path, page_title: p.page_title,
      screen_page_views: p.screen_page_views, total_users: p.total_users, sessions: p.sessions,
      avg_time_on_page_sec: p.count > 0 ? Math.round(p.time_sum / p.count) : 0,
      bounce_rate: p.count > 0 ? Math.round((p.bounce_sum / p.count) * 1000) / 1000 : 0,
      entrances: p.entrances, exits: p.exits, conversions: p.conversions,
    }))
    .sort((a, b) => b.screen_page_views - a.screen_page_views)
    .slice(0, 20)

  // ③ トラフィックソース（期間集計）
  const { data: trafficRaw, error: trafficErr } = await supabase
    .from('ga4_traffic_sources')
    .select('session_source, session_medium, sessions, total_users, new_users, conversions')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
  if (trafficErr) return NextResponse.json({ error: trafficErr.message }, { status: 500 })

  const trafficMap = new Map<string, { sessions: number; total_users: number; new_users: number; conversions: number }>()
  for (const t of trafficRaw ?? []) {
    const key = `${t.session_source} / ${t.session_medium}`
    const ex = trafficMap.get(key)
    if (ex) {
      ex.sessions    += t.sessions
      ex.total_users += t.total_users
      ex.new_users   += t.new_users
      ex.conversions += t.conversions
    } else {
      trafficMap.set(key, { sessions: t.sessions, total_users: t.total_users, new_users: t.new_users, conversions: t.conversions })
    }
  }
  const traffic = Array.from(trafficMap.entries())
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10)

  // ④ デバイス別（期間集計）
  const { data: devicesRaw, error: devicesErr } = await supabase
    .from('ga4_device_metrics')
    .select('device_category, sessions, total_users')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
  if (devicesErr) return NextResponse.json({ error: devicesErr.message }, { status: 500 })

  const deviceMap = new Map<string, { sessions: number; total_users: number }>()
  for (const d of devicesRaw ?? []) {
    const ex = deviceMap.get(d.device_category)
    if (ex) { ex.sessions += d.sessions; ex.total_users += d.total_users }
    else deviceMap.set(d.device_category, { sessions: d.sessions, total_users: d.total_users })
  }
  const devices = Array.from(deviceMap.entries())
    .map(([device_category, v]) => ({ device_category, ...v }))
    .sort((a, b) => b.sessions - a.sessions)

  // ⑤ 地域別（上位10件）
  const { data: geoRaw, error: geoErr } = await supabase
    .from('ga4_geo_metrics')
    .select('country, region, sessions, total_users')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
  if (geoErr) return NextResponse.json({ error: geoErr.message }, { status: 500 })

  const geoMap = new Map<string, { sessions: number; total_users: number }>()
  for (const g of geoRaw ?? []) {
    const key = g.region && g.region !== '(not set)' ? `${g.country} / ${g.region}` : g.country
    const ex = geoMap.get(key)
    if (ex) { ex.sessions += g.sessions; ex.total_users += g.total_users }
    else geoMap.set(key, { sessions: g.sessions, total_users: g.total_users })
  }
  const geo = Array.from(geoMap.entries())
    .map(([area, v]) => ({ area, ...v }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10)

  // ⑥ イベント別（上位10件）
  const { data: eventsRaw, error: eventsErr } = await supabase
    .from('ga4_event_metrics')
    .select('event_name, event_count, total_users, conversions')
    .eq('service_id', serviceId)
    .gte('report_date', sinceStr)
  if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 })

  const eventMap = new Map<string, { event_count: number; total_users: number; conversions: number }>()
  for (const e of eventsRaw ?? []) {
    const ex = eventMap.get(e.event_name)
    if (ex) { ex.event_count += e.event_count; ex.total_users += e.total_users; ex.conversions += e.conversions }
    else eventMap.set(e.event_name, { event_count: e.event_count, total_users: e.total_users, conversions: e.conversions })
  }
  const events = Array.from(eventMap.entries())
    .map(([event_name, v]) => ({ event_name, ...v }))
    .sort((a, b) => b.event_count - a.event_count)
    .slice(0, 10)

  return NextResponse.json({
    success: true,
    data: { days, since: sinceStr, daily: daily ?? [], pages: aggregatedPages, traffic, devices, geo, events },
  })
}

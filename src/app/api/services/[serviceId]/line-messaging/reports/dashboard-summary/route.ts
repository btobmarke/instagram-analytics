import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

/**
 * GET — MA 系の集計（統合ダッシュボード用・軽量）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const [
    contactsTotal,
    contactsFollowed,
    tagsTotal,
    segmentsTotal,
    shortLinksTotal,
    clicks30,
    broadcastJobsTotal,
    maEvents30,
  ] = await Promise.all([
    admin
      .from('line_messaging_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId),
    admin
      .from('line_messaging_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId)
      .eq('is_followed', true),
    admin
      .from('line_messaging_tags')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId),
    admin
      .from('line_messaging_segments')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId),
    admin
      .from('line_messaging_short_links')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId),
    admin
      .from('line_messaging_link_clicks')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId)
      .gte('occurred_at', since.toISOString()),
    admin
      .from('line_messaging_broadcast_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId),
    admin
      .from('line_messaging_events')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', serviceId)
      .gte('occurred_at', since.toISOString()),
  ])

  const err =
    contactsTotal.error ||
    contactsFollowed.error ||
    tagsTotal.error ||
    segmentsTotal.error ||
    shortLinksTotal.error ||
    clicks30.error ||
    broadcastJobsTotal.error ||
    maEvents30.error

  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      contacts_total: contactsTotal.count ?? 0,
      contacts_followed: contactsFollowed.count ?? 0,
      tags_total: tagsTotal.count ?? 0,
      segments_total: segmentsTotal.count ?? 0,
      short_links_total: shortLinksTotal.count ?? 0,
      link_clicks_30d: clicks30.count ?? 0,
      broadcast_jobs_total: broadcastJobsTotal.count ?? 0,
      ma_events_30d: maEvents30.count ?? 0,
    },
  })
}

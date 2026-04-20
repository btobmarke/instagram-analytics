import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'
import { buildOamContactReconcileReport } from '@/lib/line/oam-contact-reconcile-report'

type Params = { params: Promise<{ serviceId: string }> }

/**
 * GET /api/services/[serviceId]/line-messaging/reports/oam-contact-reconcile
 * Messaging contacts と OAM 付与ログ（customer_id）の突合概算
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const admin = createSupabaseAdminClient()
  const { data, error } = await buildOamContactReconcileReport(admin, serviceId)
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}

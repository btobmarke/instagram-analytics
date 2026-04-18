export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { buildDeckPagePlans } from '@/lib/instagram/proposal-deck/types'
import type { ProposalOutline } from '@/lib/instagram/proposal-schemas'

/** テンプレ v1 のメタ情報（クライアントの説明用） */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status })
  }

  const dummyOutline: ProposalOutline = {
    document_title: '（例）',
    audience: 'クライアント',
    sections: [
      { id: 's1', title: '現状', purpose: '', key_points: ['要点'] },
      { id: 's2', title: '提案', purpose: '', key_points: [] },
    ],
  }
  const examplePlans = buildDeckPagePlans(dummyOutline)

  return NextResponse.json({
    success: true,
    data: {
      templateId: 'instagram_proposal_v1',
      description:
        '表紙（cover）→ 主要指標テーブル（kpi）→ 各章1枚（section）。PPTX はこの構造から pptxgenjs で生成し、HTML 変換は経由しません。',
      pageTypes: [
        { pageKey: 'cover', slots: ['title', 'subtitle'] },
        { pageKey: 'kpi', slots: ['title', 'metric_rows[]'] },
        { pageKey: 'section', slots: ['title', 'body', 'bullets[]'], repeatsPerOutlineSection: true },
      ],
      examplePagePlans: examplePlans,
    },
  })
}

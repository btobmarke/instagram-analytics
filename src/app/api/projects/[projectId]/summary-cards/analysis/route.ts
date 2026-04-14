/**
 * GET /api/projects/[projectId]/summary-cards/analysis?sessionId=...
 *
 * セッション内のカード分析結果一覧を返す。
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const QuerySchema = z.object({
  sessionId: z.string().uuid(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = QuerySchema.safeParse({ sessionId: url.searchParams.get('sessionId') })
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('summary_card_analysis_results')
    .select('*')
    .eq('project_id', projectId)
    .eq('session_id', parsed.data.sessionId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data: data ?? [] })
}


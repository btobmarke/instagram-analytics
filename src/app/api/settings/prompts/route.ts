export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchInstagramAlgorithmInfo } from '@/lib/claude/client'

// GET /api/settings/prompts
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('analysis_prompt_settings')
    .select('*')
    .order('prompt_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// PUT /api/settings/prompts
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { prompts } = body

  if (!Array.isArray(prompts)) return NextResponse.json({ error: '不正なリクエスト形式' }, { status: 400 })

  for (const p of prompts) {
    if (!p.prompt_type || !p.prompt_text) continue
    await supabase
      .from('analysis_prompt_settings')
      .upsert({
        prompt_type: p.prompt_type,
        prompt_text: p.prompt_text,
        is_active: true,
        version: (p.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
  }

  return NextResponse.json({ success: true })
}

// POST /api/settings/prompts/algorithm — アルゴリズム情報を更新
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const algorithmInfo = await fetchInstagramAlgorithmInfo()
    const now = new Date().toISOString()

    await supabase
      .from('analysis_prompt_settings')
      .update({ algorithm_info: algorithmInfo, algorithm_fetched_at: now })
      .in('prompt_type', ['post_analysis', 'account_weekly', 'account_monthly'])

    return NextResponse.json({ data: { algorithm_info: algorithmInfo, fetched_at: now } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

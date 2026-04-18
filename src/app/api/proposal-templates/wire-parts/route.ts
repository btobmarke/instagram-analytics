import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind') as 'wire' | 'part' | null

  let q = supabase.from('proposal_template_elements').select('*').order('updated_at', { ascending: false })
  if (kind === 'wire' || kind === 'part') {
    q = q.eq('element_kind', kind)
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string
    elementKind?: 'wire' | 'part'
    tags?: string[]
    remarks?: string | null
    htmlContent?: string
  }

  if (!body.name?.trim() || (body.elementKind !== 'wire' && body.elementKind !== 'part')) {
    return NextResponse.json({ success: false, error: 'name と elementKind（wire|part）が必要です' }, { status: 400 })
  }
  if (typeof body.htmlContent !== 'string' || !body.htmlContent.trim()) {
    return NextResponse.json({ success: false, error: 'htmlContent が必要です' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('proposal_template_elements')
    .insert({
      name: body.name.trim(),
      element_kind: body.elementKind,
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      remarks: body.remarks?.trim() || null,
      html_content: body.htmlContent,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
}

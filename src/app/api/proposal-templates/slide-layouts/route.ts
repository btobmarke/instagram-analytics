import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

async function assertElementKind(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string,
  kind: 'wire' | 'part',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from('proposal_template_elements').select('element_kind').eq('id', id).maybeSingle()
  if (error || !data) return { ok: false, error: '要素が見つかりません' }
  if (data.element_kind !== kind) {
    return { ok: false, error: kind === 'wire' ? 'ワイヤーではない要素です' : 'パーツではない要素です' }
  }
  return { ok: true }
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: layouts, error } = await supabase.from('proposal_slide_layouts').select('*').order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data: layouts ?? [] })
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
    tags?: string[]
    remarks?: string | null
    pageKind?: 'cover' | 'kpi' | 'section'
    wireElementId?: string
    partElementIds?: string[]
  }

  if (!body.name?.trim() || !body.wireElementId) {
    return NextResponse.json({ success: false, error: 'name と wireElementId が必要です' }, { status: 400 })
  }
  if (!body.pageKind || !['cover', 'kpi', 'section'].includes(body.pageKind)) {
    return NextResponse.json({ success: false, error: 'pageKind が不正です' }, { status: 400 })
  }

  const w = await assertElementKind(supabase, body.wireElementId, 'wire')
  if (!w.ok) {
    return NextResponse.json({ success: false, error: w.error }, { status: 400 })
  }

  const partIds = Array.isArray(body.partElementIds) ? body.partElementIds : []
  for (const pid of partIds) {
    const p = await assertElementKind(supabase, pid, 'part')
    if (!p.ok) {
      return NextResponse.json({ success: false, error: `パーツ ${pid}: ${p.error}` }, { status: 400 })
    }
  }

  const { data: layout, error: insErr } = await supabase
    .from('proposal_slide_layouts')
    .insert({
      name: body.name.trim(),
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      remarks: body.remarks?.trim() || null,
      page_kind: body.pageKind,
      wire_element_id: body.wireElementId,
    })
    .select('*')
    .single()

  if (insErr || !layout) {
    return NextResponse.json({ success: false, error: insErr?.message ?? 'insert failed' }, { status: 500 })
  }

  if (partIds.length > 0) {
    const rows = partIds.map((part_element_id, sort_order) => ({
      slide_layout_id: layout.id,
      part_element_id,
      sort_order,
    }))
    const { error: pErr } = await supabase.from('proposal_slide_layout_parts').insert(rows)
    if (pErr) {
      await supabase.from('proposal_slide_layouts').delete().eq('id', layout.id)
      return NextResponse.json({ success: false, error: pErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, data: layout })
}

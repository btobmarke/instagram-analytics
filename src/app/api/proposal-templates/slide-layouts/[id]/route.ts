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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: layout, error: lErr } = await supabase.from('proposal_slide_layouts').select('*').eq('id', id).maybeSingle()
  if (lErr) {
    return NextResponse.json({ success: false, error: lErr.message }, { status: 500 })
  }
  if (!layout) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const { data: wire } = await supabase.from('proposal_template_elements').select('*').eq('id', layout.wire_element_id).maybeSingle()

  const { data: partLinks } = await supabase
    .from('proposal_slide_layout_parts')
    .select('part_element_id, sort_order')
    .eq('slide_layout_id', id)
    .order('sort_order', { ascending: true })

  const parts: unknown[] = []
  for (const link of partLinks ?? []) {
    const { data: p } = await supabase.from('proposal_template_elements').select('*').eq('id', link.part_element_id).maybeSingle()
    if (p) parts.push({ ...p, sort_order: link.sort_order })
  }

  return NextResponse.json({
    success: true,
    data: {
      ...layout,
      wire,
      parts,
    },
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const { data: existing } = await supabase.from('proposal_slide_layouts').select('id').eq('id', id).maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.tags !== undefined) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean)
  if (body.remarks !== undefined) patch.remarks = body.remarks?.trim() || null
  if (body.pageKind !== undefined) {
    if (!['cover', 'kpi', 'section'].includes(body.pageKind)) {
      return NextResponse.json({ success: false, error: 'pageKind が不正です' }, { status: 400 })
    }
    patch.page_kind = body.pageKind
  }
  if (body.wireElementId !== undefined) {
    const w = await assertElementKind(supabase, body.wireElementId, 'wire')
    if (!w.ok) {
      return NextResponse.json({ success: false, error: w.error }, { status: 400 })
    }
    patch.wire_element_id = body.wireElementId
  }

  if (Object.keys(patch).length > 0) {
    const { error: uErr } = await supabase.from('proposal_slide_layouts').update(patch).eq('id', id)
    if (uErr) {
      return NextResponse.json({ success: false, error: uErr.message }, { status: 500 })
    }
  }

  if (body.partElementIds !== undefined) {
    const partIds = Array.isArray(body.partElementIds) ? body.partElementIds : []
    for (const pid of partIds) {
      const p = await assertElementKind(supabase, pid, 'part')
      if (!p.ok) {
        return NextResponse.json({ success: false, error: `パーツ ${pid}: ${p.error}` }, { status: 400 })
      }
    }
    await supabase.from('proposal_slide_layout_parts').delete().eq('slide_layout_id', id)
    if (partIds.length > 0) {
      const rows = partIds.map((part_element_id, sort_order) => ({
        slide_layout_id: id,
        part_element_id,
        sort_order,
      }))
      const { error: pErr } = await supabase.from('proposal_slide_layout_parts').insert(rows)
      if (pErr) {
        return NextResponse.json({ success: false, error: pErr.message }, { status: 500 })
      }
    }
  }

  const { data: layout } = await supabase.from('proposal_slide_layouts').select('*').eq('id', id).single()
  return NextResponse.json({ success: true, data: layout })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase.from('proposal_slide_layouts').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

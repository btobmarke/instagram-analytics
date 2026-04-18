import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { ResolvedSlideRow } from '@/lib/instagram/proposal-templates/resolve-design-template'

async function expandSlideLayout(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  slideLayoutId: string,
): Promise<ResolvedSlideRow | null> {
  const { data: layout } = await supabase.from('proposal_slide_layouts').select('*').eq('id', slideLayoutId).maybeSingle()
  if (!layout) return null
  const { data: wire } = await supabase
    .from('proposal_template_elements')
    .select('html_content')
    .eq('id', layout.wire_element_id)
    .maybeSingle()
  const { data: partLinks } = await supabase
    .from('proposal_slide_layout_parts')
    .select('part_element_id, sort_order')
    .eq('slide_layout_id', slideLayoutId)
    .order('sort_order', { ascending: true })

  const partHtmls: string[] = []
  for (const link of partLinks ?? []) {
    const { data: p } = await supabase.from('proposal_template_elements').select('html_content').eq('id', link.part_element_id).maybeSingle()
    if (p?.html_content) partHtmls.push(p.html_content)
  }

  return {
    wireHtml: wire?.html_content ?? '',
    partHtmls,
  }
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

  const { data: template, error: tErr } = await supabase.from('proposal_design_templates').select('*').eq('id', id).maybeSingle()
  if (tErr) {
    return NextResponse.json({ success: false, error: tErr.message }, { status: 500 })
  }
  if (!template) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const { data: links } = await supabase
    .from('proposal_design_template_slides')
    .select('slide_layout_id, sort_order')
    .eq('design_template_id', id)
    .order('sort_order', { ascending: true })

  const slideRows: Array<{
    sortOrder: number
    slideLayoutId: string
    pageKind: string
    layoutName: string
    resolved: ResolvedSlideRow
  }> = []

  for (const link of links ?? []) {
    const { data: lay } = await supabase.from('proposal_slide_layouts').select('name, page_kind').eq('id', link.slide_layout_id).maybeSingle()
    const resolved = await expandSlideLayout(supabase, link.slide_layout_id)
    if (!resolved || !lay) continue
    slideRows.push({
      sortOrder: link.sort_order,
      slideLayoutId: link.slide_layout_id,
      pageKind: lay.page_kind,
      layoutName: lay.name,
      resolved,
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      ...template,
      slides: slideRows,
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
    slideLayoutIds?: string[]
  }

  const { data: existing } = await supabase.from('proposal_design_templates').select('id').eq('id', id).maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.tags !== undefined) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean)
  if (body.remarks !== undefined) patch.remarks = body.remarks?.trim() || null

  if (Object.keys(patch).length > 0) {
    const { error: uErr } = await supabase.from('proposal_design_templates').update(patch).eq('id', id)
    if (uErr) {
      return NextResponse.json({ success: false, error: uErr.message }, { status: 500 })
    }
  }

  if (body.slideLayoutIds !== undefined) {
    const slideLayoutIds = Array.isArray(body.slideLayoutIds) ? body.slideLayoutIds.filter(Boolean) : []
    if (slideLayoutIds.length === 0) {
      return NextResponse.json({ success: false, error: 'slideLayoutIds を1件以上指定してください' }, { status: 400 })
    }
    await supabase.from('proposal_design_template_slides').delete().eq('design_template_id', id)
    const rows = slideLayoutIds.map((slide_layout_id, sort_order) => ({
      design_template_id: id,
      slide_layout_id,
      sort_order,
    }))
    const { error: rErr } = await supabase.from('proposal_design_template_slides').insert(rows)
    if (rErr) {
      return NextResponse.json({ success: false, error: rErr.message }, { status: 500 })
    }
  }

  const { data: template } = await supabase.from('proposal_design_templates').select('*').eq('id', id).single()
  return NextResponse.json({ success: true, data: template })
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

  const { error } = await supabase.from('proposal_design_templates').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

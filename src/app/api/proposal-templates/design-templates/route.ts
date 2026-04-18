import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase.from('proposal_design_templates').select('*').order('updated_at', { ascending: false })
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
    tags?: string[]
    remarks?: string | null
    slideLayoutIds?: string[]
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ success: false, error: 'name が必要です' }, { status: 400 })
  }
  const slideLayoutIds = Array.isArray(body.slideLayoutIds) ? body.slideLayoutIds.filter(Boolean) : []
  if (slideLayoutIds.length === 0) {
    return NextResponse.json({ success: false, error: 'slideLayoutIds を1件以上指定してください' }, { status: 400 })
  }

  const { data: template, error: tErr } = await supabase
    .from('proposal_design_templates')
    .insert({
      name: body.name.trim(),
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      remarks: body.remarks?.trim() || null,
    })
    .select('*')
    .single()

  if (tErr || !template) {
    return NextResponse.json({ success: false, error: tErr?.message ?? 'insert failed' }, { status: 500 })
  }

  const rows = slideLayoutIds.map((slide_layout_id, sort_order) => ({
    design_template_id: template.id,
    slide_layout_id,
    sort_order,
  }))

  const { error: rErr } = await supabase.from('proposal_design_template_slides').insert(rows)
  if (rErr) {
    await supabase.from('proposal_design_templates').delete().eq('id', template.id)
    return NextResponse.json({ success: false, error: rErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: template })
}

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase.from('proposal_template_elements').select('*').eq('id', id).maybeSingle()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true, data })
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
    htmlContent?: string
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : []
  if (body.remarks !== undefined) patch.remarks = body.remarks?.trim() || null
  if (body.htmlContent !== undefined) patch.html_content = body.htmlContent

  const { data, error } = await supabase.from('proposal_template_elements').update(patch).eq('id', id).select('*').single()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, data })
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

  const { error } = await supabase.from('proposal_template_elements').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

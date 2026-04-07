import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET: 全URLテンプレートを取得
export async function GET(_req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('line_oam_url_templates')
    .select('*')
    .order('csv_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

// POST: URLテンプレートを更新（csv_type ごとに UPSERT）
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  // body: [{ csv_type, url_template, description }]
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'body must be an array' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('line_oam_url_templates')
    .upsert(
      body.map((item: { csv_type: string; url_template: string; description?: string }) => ({
        csv_type:     item.csv_type,
        url_template: item.url_template,
        description:  item.description ?? null,
        updated_at:   new Date().toISOString(),
      })),
      { onConflict: 'csv_type' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

/**
 * GET  /api/projects/[projectId]/location  → 現在の位置情報を返す
 * PUT  /api/projects/[projectId]/location  → 位置情報を更新
 * DELETE /api/projects/[projectId]/location → 位置情報を削除
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select('id, latitude, longitude, location_name')
    .eq('id', projectId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    data: {
      latitude:      data.latitude,
      longitude:     data.longitude,
      location_name: data.location_name,
    },
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { latitude, longitude, location_name } = body

  if (latitude == null || longitude == null) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'latitude と longitude は必須です' } },
      { status: 400 },
    )
  }

  const lat = Number(latitude)
  const lng = Number(longitude)
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: '緯度は -90〜90、経度は -180〜180 の範囲で入力してください' } },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('projects')
    .update({
      latitude:      lat,
      longitude:     lng,
      location_name: location_name ?? null,
    })
    .eq('id', projectId)

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })

  const { error } = await supabase
    .from('projects')
    .update({ latitude: null, longitude: null, location_name: null })
    .eq('id', projectId)

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

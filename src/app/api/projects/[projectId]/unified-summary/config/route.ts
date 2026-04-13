/**
 * GET /api/projects/[projectId]/unified-summary/config
 *
 * プロジェクト内のアクティブサービス一覧と、
 * 各サービスで利用可能な指標カタログを返す。
 * フロントエンドの初期化（列定義・フィルタ UI）で使用する。
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       projectId: string,
 *       projectName: string,
 *       services: {
 *         id: string,
 *         name: string,
 *         serviceType: string,
 *         availableMetrics: MetricCard[]
 *       }[]
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getMetricCatalog } from '@/app/(dashboard)/projects/[projectId]/services/[serviceId]/summary/_lib/catalog'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const supabase = await createSupabaseServerClient()

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } },
      { status: 401 },
    )
  }

  // プロジェクト存在チェック
  const { data: project } = await supabase
    .from('projects')
    .select('id, project_name')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'プロジェクトが見つかりません' } },
      { status: 404 },
    )
  }

  // アクティブサービス一覧取得（deleted_at IS NULL）
  const { data: services, error } = await supabase
    .from('services')
    .select('id, service_name, service_type')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  // 各サービスのメトリクスカタログを付与
  const servicesWithMetrics = (services ?? []).map(svc => ({
    id:               svc.id,
    name:             svc.service_name,
    serviceType:      svc.service_type,
    availableMetrics: getMetricCatalog(svc.service_type),
  }))

  return NextResponse.json({
    success: true,
    data: {
      projectId:   project.id,
      projectName: project.project_name,
      services:    servicesWithMetrics,
    },
  })
}

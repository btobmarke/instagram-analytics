import { redirect } from 'next/navigation'

/** 旧 OAM 専用ダッシュボード → 統合ダッシュボードへ */
export default async function LineOamDashboardRedirect({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = await params
  redirect(`/projects/${projectId}/services/${serviceId}/line-ma/dashboard`)
}

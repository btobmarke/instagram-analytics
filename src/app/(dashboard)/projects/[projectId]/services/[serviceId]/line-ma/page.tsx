import { redirect } from 'next/navigation'

/**
 * 旧「接続」ルート。統合ダッシュボードへ誘導。
 */
export default async function LineMaRootRedirect({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = await params
  redirect(`/projects/${projectId}/services/${serviceId}/line-ma/dashboard`)
}

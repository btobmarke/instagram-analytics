import { LineUnifiedDashboard } from '../_components/line-unified-dashboard'

export default function LineMaDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  return <LineUnifiedDashboard params={params} />
}

import { LineMaShell } from './line-ma-shell'

export default async function LineMaLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = await params
  return (
    <LineMaShell projectId={projectId} serviceId={serviceId}>
      {children}
    </LineMaShell>
  )
}

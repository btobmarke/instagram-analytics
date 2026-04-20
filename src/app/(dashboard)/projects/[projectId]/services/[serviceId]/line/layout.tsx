import { LineAppShell } from './line-app-shell'

export default async function LineServiceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = await params
  return (
    <LineAppShell projectId={projectId} serviceId={serviceId}>
      {children}
    </LineAppShell>
  )
}

'use client'

import { LineMaNav } from './line-ma-nav'

export function LineMaShell({
  projectId,
  serviceId,
  children,
}: {
  projectId: string
  serviceId: string
  children: React.ReactNode
}) {
  return (
    <div className="line-ma-layout">
      <LineMaNav projectId={projectId} serviceId={serviceId} />
      {children}
    </div>
  )
}

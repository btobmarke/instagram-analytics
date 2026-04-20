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
    <div className="line-ma-layout w-full max-w-none min-w-0">
      <LineMaNav projectId={projectId} serviceId={serviceId} />
      <div className="w-full max-w-none min-w-0">{children}</div>
    </div>
  )
}

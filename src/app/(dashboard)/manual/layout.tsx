import type { ReactNode } from 'react'
import { ManualNav } from './_components/ManualNav'

export default function ManualLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-6 max-w-7xl mx-auto">
      <ManualNav />
      {children}
    </div>
  )
}

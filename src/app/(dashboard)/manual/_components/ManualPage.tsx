import type { ReactNode } from 'react'

interface ManualPageProps {
  title: string
  description?: string
  breadcrumb?: string
  children: ReactNode
}

export function ManualPage({ title, description, breadcrumb, children }: ManualPageProps) {
  return (
    <article className="flex-1 min-w-0">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        {breadcrumb && (
          <p className="text-xs text-gray-400 mb-2">{breadcrumb}</p>
        )}
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description && (
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{description}</p>
        )}
        <div className="manual-body mt-6 space-y-6">{children}</div>
      </div>
    </article>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 border-l-4 border-purple-400 pl-3 mb-3">
        {title}
      </h2>
      <div className="text-sm text-gray-700 leading-relaxed space-y-3">{children}</div>
    </section>
  )
}

export function StepList({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold flex items-center justify-center">
            {i + 1}
          </span>
          <div className="flex-1">{s}</div>
        </li>
      ))}
    </ol>
  )
}

export function InfoBox({
  tone = 'info',
  children,
  title,
}: {
  tone?: 'info' | 'warn' | 'tip'
  children: ReactNode
  title?: string
}) {
  const map = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    tip: 'bg-green-50 border-green-200 text-green-800',
  }
  return (
    <div className={`border rounded-xl p-4 text-sm leading-relaxed ${map[tone]}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

export function Table({
  head,
  rows,
}: {
  head: string[]
  rows: (string | ReactNode)[][]
}) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-xl">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="text-left text-xs font-semibold text-gray-600 px-4 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-gray-700 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-gray-100 text-gray-800 text-xs font-mono px-1.5 py-0.5 rounded">
      {children}
    </code>
  )
}

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/ui/Sidebar'
import type { IgAccount } from '@/types'

async function getAccounts(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<IgAccount[]> {
  const { data } = await supabase
    .from('ig_accounts')
    .select('*')
    .order('display_order', { ascending: true })
  return (data ?? []) as IgAccount[]
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const accounts = await getAccounts(supabase)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar accounts={accounts} />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

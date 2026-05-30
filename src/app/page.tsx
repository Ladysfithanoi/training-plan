import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Never prerender the root — always resolve at request time
export const dynamic = 'force-dynamic'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}

'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session && pathname === '/login') {
        router.replace('/')
        return
      }
      if (!session && pathname !== '/login') {
        router.replace('/login')
        return
      }
      setReady(true)
    }
    check()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && pathname !== '/login') {
        router.replace('/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [pathname, router])

  if (!ready) return null

  return <>{children}</>
}

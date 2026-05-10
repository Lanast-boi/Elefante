'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ElefanteLogo from '@/components/ElefanteLogo'
import { useTheme } from '@/components/ThemeProvider'

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

// Sign-out arrow icon — shown alone on mobile, with text on desktop
function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()

  if (pathname === '/login') return null

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
        pathname === href
          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-100 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-2">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight shrink-0">
          <ElefanteLogo className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
          <span className="hidden xs:inline sm:inline">Elefante</span>
        </Link>

        {/* Nav items */}
        <div className="flex items-center gap-1 min-w-0">
          {/* Follow-ups — always visible */}
          {navLink('/follow-ups', 'Follow-ups')}

          {/* Import — hidden on narrow mobile, visible at sm+ */}
          <span className="hidden sm:block">
            {navLink('/import', 'Import')}
          </span>

          {/* + Add */}
          <Link
            href="/contacts/new"
            className="ml-1 sm:ml-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium px-3 sm:px-4 py-1.5 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors whitespace-nowrap"
          >
            + Add
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="ml-1 p-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Sign out — icon on mobile, text on sm+ */}
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            className="ml-1 p-1.5 sm:px-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <SignOutIcon />
            <span className="hidden sm:inline text-xs ml-1">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

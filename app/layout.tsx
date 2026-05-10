import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import Nav from '@/components/Nav'
import AuthProvider from '@/components/AuthProvider'
import ThemeProvider from '@/components/ThemeProvider'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

// ── Viewport ──────────────────────────────────────────────────────────────────
// Exported separately from metadata per Next.js 14+ convention.
// viewportFit: 'cover'  — lets the app extend under notch / Dynamic Island.
//   Safe-area insets are then applied in globals.css so content stays clear.
// themeColor             — colors the iOS status bar and Android toolbar.
//   Two entries (light + dark) cover system preference before JS hydrates.
//   ThemeProvider overrides these tags dynamically when the user toggles.

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)',  color: '#09090b' },
  ],
}

// ── Metadata ──────────────────────────────────────────────────────────────────
// Icons are intentionally omitted here — Next.js auto-generates the correct
// link tags from app/icon.tsx (favicon) and app/apple-icon.tsx (iOS touch icon).
// Keeping manual icon entries here would create broken duplicate link tags.

export const metadata: Metadata = {
  title: 'Elefante',
  description: 'Personal relationship manager',
}

// ── Theme + theme-color FOUC prevention ──────────────────────────────────────
// Runs synchronously before first paint.
// 1. Applies .dark class to <html> so Tailwind dark variants render correctly.
// 2. Updates ALL <meta name="theme-color"> tags so the iOS status bar /
//    Android toolbar shows the right colour before React hydrates.

const themeScript = `try{
  const t=localStorage.getItem('elefante-theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  if(t==='dark'){
    document.documentElement.classList.add('dark');
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(el){el.setAttribute('content','#09090b')});
  }
}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
        <ThemeProvider>
          <AuthProvider>
            <Nav />
            <main className="max-w-2xl mx-auto px-4 py-10">
              {children}
            </main>
          </AuthProvider>
        </ThemeProvider>

        {/* Register service worker after hydration — required for Chrome PWA install prompt */}
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
          }
        `}</Script>
      </body>
    </html>
  )
}

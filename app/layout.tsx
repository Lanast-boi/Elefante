import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Nav from '@/components/Nav'
import AuthProvider from '@/components/AuthProvider'
import ThemeProvider from '@/components/ThemeProvider'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: 'Elefante',
  description: 'Personal relationship manager',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
}

// Runs synchronously before first paint — prevents flash of wrong theme
const themeScript = `try{const t=localStorage.getItem('elefante-theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}`

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
      </body>
    </html>
  )
}

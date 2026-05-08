import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Elefante',
    short_name: 'Elefante',
    description: 'Personal relationship manager',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#18181b',
    icons: [
      {
        // Served by app/icon-192/route.tsx — purpose 'any' (non-adaptive)
        src: '/icon-192',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        // Served by app/icon-512/route.tsx — maskable, elephant within safe zone
        src: '/icon-512',
        sizes: '512x512',
        type: 'image/png',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purpose: 'maskable' as any,
      },
    ],
  }
}

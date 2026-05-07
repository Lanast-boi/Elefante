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
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purpose: 'any maskable' as any,
      },
    ],
  }
}

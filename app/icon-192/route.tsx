import { ImageResponse } from 'next/og'
import { ElephantIcon } from '@/app/apple-icon'

// Served at /icon-192 — referenced by the web app manifest.
// purpose: 'any'  →  used wherever a non-adaptive icon is needed.
// No special safe-zone requirement; elephant can fill up to ~62% of the icon.

export function GET() {
  return new ImageResponse(
    <ElephantIcon bg="#18181b" fg="white" cut="#18181b" size={192} radius={40} />,
    { width: 192, height: 192 },
  )
}

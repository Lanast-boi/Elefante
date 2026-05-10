import { ImageResponse } from 'next/og'
import { ElephantIcon } from '@/app/apple-icon'

// Served at /icon-512 — referenced by the web app manifest.
// purpose: 'maskable'  →  Android adaptive icons clip to a shape (circle, squircle, etc.)
//
// Maskable safe zone: a circle with radius = 40% of icon size (204.8 px for 512).
// The elephant SVG must fit entirely within that circle.
//
// With svgSize = 512 * 0.48 = 246 px, centered:
//   extremes at 256 ± 123 → max corner distance = sqrt(123² + 123²) ≈ 174 px
//   174 < 204.8  →  all elephant pixels are within the safe zone. ✓
//
// Square background, no border radius — the OS applies its own adaptive shape.

export function GET() {
  return new ImageResponse(
    <ElephantIconMaskable />,
    { width: 512, height: 512 },
  )
}

function ElephantIconMaskable() {
  const s = 512
  const svgSize = Math.round(s * 0.48) // 245 px — safely inside 40%-radius circle

  return (
    <div
      style={{
        width: s,
        height: s,
        background: '#18181b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={svgSize} height={svgSize} viewBox="0 0 100 100" style={{ display: 'block' }}>
        <rect x="10" y="20" width="60" height="60" rx="20" fill="white" />
        <circle cx="65" cy="40" r="20" fill="white" />
        <path d="M75 50 Q85 60 75 70 Q70 75 65 70" fill="white" />
        <rect x="30" y="55" width="20" height="25" rx="10" fill="#18181b" />
        <path d="M55 25 Q45 35 55 45" stroke="#18181b" strokeWidth="4" fill="none" />
        <circle cx="72" cy="38" r="2" fill="#18181b" />
      </svg>
    </div>
  )
}

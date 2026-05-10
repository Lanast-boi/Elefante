import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Next.js reads this file and automatically adds:
//   <link rel="apple-touch-icon" href="/apple-icon.png" />
// This replaces the manual icons.apple entry in layout metadata.

export default function AppleIcon() {
  return new ImageResponse(<ElephantIcon bg="#18181b" fg="white" cut="#18181b" size={180} radius={36} />, { ...size })
}

// Shared elephant icon — works in any ImageResponse context (satori subset of CSS/SVG).
// All styles are inline; no Tailwind className.
export function ElephantIcon({
  bg,
  fg,
  cut,
  size: s,
  radius = 0,
}: {
  bg: string
  fg: string
  cut: string
  size: number
  radius?: number
}) {
  // Elephant occupies ~62% of the icon. Fine for non-maskable icons.
  const svgSize = Math.round(s * 0.62)

  return (
    <div
      style={{
        width: s,
        height: s,
        background: bg,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 100 100"
        style={{ display: 'block' }}
      >
        {/* Body */}
        <rect x="10" y="20" width="60" height="60" rx="20" fill={fg} />
        {/* Head */}
        <circle cx="65" cy="40" r="20" fill={fg} />
        {/* Trunk */}
        <path d="M75 50 Q85 60 75 70 Q70 75 65 70" fill={fg} />
        {/* Leg gap — negative space */}
        <rect x="30" y="55" width="20" height="25" rx="10" fill={cut} />
        {/* Ear curve — negative space */}
        <path d="M55 25 Q45 35 55 45" stroke={cut} strokeWidth="4" fill="none" />
        {/* Eye */}
        <circle cx="72" cy="38" r="2" fill={cut} />
      </svg>
    </div>
  )
}

import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#18181b',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          color: 'white',
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '-0.5px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        E
      </div>
    ),
    { ...size },
  )
}

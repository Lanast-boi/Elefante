export default function ElefanteLogo({
  className = "w-6 h-6",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="currentColor"
    >
      {/* Body */}
      <rect x="10" y="20" width="60" height="60" rx="20" />

      {/* Head */}
      <circle cx="65" cy="40" r="20" />

      {/* Trunk */}
      <path d="M75 50 Q85 60 75 70 Q70 75 65 70" />

      {/* Leg cutout */}
      <rect x="30" y="55" width="20" height="25" rx="10" fill="white" />

      {/* Ear (negative space style) */}
      <path
        d="M55 25 Q45 35 55 45"
        stroke="white"
        strokeWidth="4"
        fill="none"
      />

      {/* Eye */}
      <circle cx="72" cy="38" r="2" fill="white" />
    </svg>
  );
}
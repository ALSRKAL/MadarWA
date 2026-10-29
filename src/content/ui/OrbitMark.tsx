/** MadarWA orbit mark. One source for the panel, lock screen and popup. */
export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <ellipse
        cx="12"
        cy="12"
        rx="9.2"
        ry="4.1"
        stroke="currentColor"
        strokeWidth="1.75"
        transform="rotate(-28 12 12)"
      />
      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

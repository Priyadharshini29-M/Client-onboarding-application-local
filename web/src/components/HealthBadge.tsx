import { healthTone } from '../lib/format'

/** Health out of 100 with the reasons on hover, so the number is never a mystery. */
export function HealthBadge({ score, reasons }: { score: number; reasons: string[] }) {
  const tone = healthTone(score)
  return (
    <span className="health" title={reasons.length ? `Losing points for: ${reasons.join(', ')}` : 'Nothing needs attention'} style={{ ['--h' as string]: tone }}>
      <svg width="30" height="30" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 94.2} 94.2`} transform="rotate(-90 18 18)" />
      </svg>
      <span><b>{score}</b><small>/100 health</small></span>
    </span>
  )
}

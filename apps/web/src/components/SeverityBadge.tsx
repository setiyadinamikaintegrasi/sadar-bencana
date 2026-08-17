import { SEVERITY_TONES, severityLabel, severityTone } from './severityTones'

interface SeverityBadgeProps {
  severity?: string | null
  /** Aktifkan animasi berkedip bertingkat (hanya tone critical/high). */
  pulse?: boolean
  className?: string
}

export default function SeverityBadge({ severity, pulse = false, className = '' }: SeverityBadgeProps) {
  const tone = SEVERITY_TONES[severityTone(severity)]
  const blink = pulse && tone.blink ? ` ${tone.blink}` : ''
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}${blink} ${className}`.trim()}>
      {severityLabel(severity)}
    </span>
  )
}

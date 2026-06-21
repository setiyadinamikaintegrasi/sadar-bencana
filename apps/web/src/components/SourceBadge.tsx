export interface SourceBadgeProps {
  source: string
  timestamp?: string
}

type SourceStyle = {
  label: string
  classes: string
}

const sourceStyles: Record<string, SourceStyle> = {
  usgs: {
    label: 'USGS',
    classes: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/30',
  },
  bmkg: {
    label: 'BMKG',
    classes: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30',
  },
  gdacs: {
    label: 'GDACS',
    classes:
      'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  },
}

const defaultStyle: SourceStyle = {
  label: '',
  classes: 'bg-slate-700/60 text-slate-200 ring-1 ring-inset ring-slate-500/40',
}

function resolveStyle(source: string): SourceStyle {
  const key = source.toLowerCase()
  const matched = sourceStyles[key]
  if (matched) return matched
  return {
    ...defaultStyle,
    label: source.toUpperCase(),
  }
}

function minutesAgo(timestamp: string): number {
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return 0
  const diffMs = Date.now() - then
  return Math.max(0, Math.round(diffMs / 60000))
}

function relativeLabel(timestamp: string): string {
  const mins = minutesAgo(timestamp)
  if (mins < 1) return 'updated just now'
  if (mins === 1) return 'updated 1 min ago'
  if (mins < 60) return `updated ${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours === 1) return 'updated 1 hr ago'
  if (hours < 24) return `updated ${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'updated 1 day ago' : `updated ${days} days ago`
}

export default function SourceBadge({ source, timestamp }: SourceBadgeProps) {
  const style = resolveStyle(source)
  const showUpdated = Boolean(timestamp)

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${style.classes}`}
      >
        {style.label}
      </span>
      {showUpdated && timestamp ? (
        <span className="text-[11px] text-slate-500">{relativeLabel(timestamp)}</span>
      ) : null}
    </div>
  )
}

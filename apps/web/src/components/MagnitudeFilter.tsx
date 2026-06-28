export interface MagnitudeFilterProps {
  value: number
  onChange: (value: number) => void
}

const options = [
  { label: 'All', value: 0 },
  { label: 'M3+', value: 3 },
  { label: 'M4+', value: 4 },
  { label: 'M5+', value: 5 },
  { label: 'M6+', value: 6 },
] as const

export default function MagnitudeFilter({ value, onChange }: MagnitudeFilterProps) {
  return (
    <label className="inline-flex items-center gap-3 text-sm text-slate-300">
      <span className="text-xs font-medium text-slate-400">
        Min Magnitude
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-slate-800 text-slate-100">
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

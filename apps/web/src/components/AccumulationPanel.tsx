import type { AccumulationResult } from '../lib/api/client'
import { PERIL_LABELS, formatIDRCompact } from '../features/contracts/format'

type Props = {
  result: AccumulationResult | null
  radiusKm: number
  onRadiusChange: (n: number) => void
  peril: string
  onPerilChange: (p: string) => void
  whatIf: boolean
  onToggleWhatIf: () => void
  onClear: () => void
}

const PERIL_OPTIONS = ['', 'earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other']

export default function AccumulationPanel({
  result, radiusKm, onRadiusChange, peril, onPerilChange, whatIf, onToggleWhatIf, onClear,
}: Props) {
  const s = result?.summary
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-[600] w-64 rounded-xl border border-slate-700/80 bg-slate-950/90 p-3 text-slate-200 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Akumulasi</p>
        <button onClick={onClear} className="text-[10px] text-slate-400 hover:text-slate-200">clear</button>
      </div>

      <button
        onClick={onToggleWhatIf}
        className={`mt-2 w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
          whatIf ? 'bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/50' : 'bg-slate-800 text-slate-200'
        }`}
      >
        {whatIf ? 'Mode What-if: klik peta untuk pin' : 'Aktifkan Mode What-if'}
      </button>

      <label className="mt-3 block text-[11px] text-slate-400">
        Radius: <span className="font-semibold text-slate-100">{radiusKm} km</span>
        <input
          type="range" min={10} max={200} step={5} value={radiusKm}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </label>

      <label className="mt-2 block text-[11px] text-slate-400">
        Filter peril
        <select
          value={peril}
          onChange={(e) => onPerilChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
        >
          {PERIL_OPTIONS.map((p) => (
            <option key={p} value={p}>{p === '' ? 'Semua' : PERIL_LABELS[p]}</option>
          ))}
        </select>
      </label>

      {s ? (
        <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-xs">
          <Row label="Objek terdampak" value={`${s.count}`} />
          <Row label="TSI" value={formatIDRCompact(s.sum_insured)} />
          <Row label="Share (eksposur)" value={formatIDRCompact(s.share_amount)} strong />
          <Row label="Premi" value={formatIDRCompact(s.premium)} />
          <Row label="Klaim" value={formatIDRCompact(s.claim_amount)} />
          {result!.by_peril.length > 0 && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              {result!.by_peril.map((b) => (
                <Row key={b.peril} label={PERIL_LABELS[b.peril] ?? b.peril} value={`${formatIDRCompact(b.share_amount)} (${b.count})`} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">Pilih event atau drop pin what-if untuk menghitung akumulasi.</p>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-semibold text-violet-200' : 'text-slate-200'}>{value}</span>
    </div>
  )
}

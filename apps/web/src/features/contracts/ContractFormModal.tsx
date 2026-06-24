import { useState } from 'react'
import {
  createContract,
  updateContract,
  type AcceptanceContract,
} from '../../lib/api/client'
import { PERIL_LABELS } from './format'

type Props = {
  initial?: AcceptanceContract
  onClose: () => void
  onSaved: () => void
}

const PERILS = ['earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other'] as const

const NUMERIC_FIELDS = [
  'latitude', 'longitude', 'sum_insured', 'share_pct', 'share_amount', 'premium', 'claim_amount',
] as const

export default function ContractFormModal({ initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Partial<AcceptanceContract>>(
    initial ?? { peril: 'earthquake', treaty_type: 'facultative', currency: 'IDR' },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof AcceptanceContract, v: string) => {
    const numeric = (NUMERIC_FIELDS as readonly string[]).includes(k)
    setForm((f) => ({ ...f, [k]: numeric ? Number(v) : v }))
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      // Auto-derive share_amount if left blank.
      const body = { ...form }
      if (!body.share_amount && body.sum_insured && body.share_pct) {
        body.share_amount = (body.sum_insured * body.share_pct) / 100
      }
      if (initial) await updateContract(initial.id, body)
      else await createContract(body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: keyof AcceptanceContract, type = 'text') => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type={type}
        value={(form[key] as string | number | undefined) ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h3 className="text-lg font-semibold text-slate-50">
          {initial ? 'Edit Kontrak' : 'Tambah Kontrak'}
        </h3>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {field('No. Kontrak', 'contract_no')}
          {field('Cedant', 'cedant_name')}
          {field('Nama Objek', 'object_name')}
          {field('Alamat', 'object_address')}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Peril
            <select
              value={form.peril ?? 'earthquake'}
              onChange={(e) => set('peril', e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              {PERILS.map((p) => (
                <option key={p} value={p}>{PERIL_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Tipe Treaty
            <select
              value={form.treaty_type ?? 'facultative'}
              onChange={(e) => set('treaty_type', e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              <option value="facultative">Facultative</option>
              <option value="treaty">Treaty</option>
            </select>
          </label>
          {field('Occupancy', 'occupancy')}
          {field('Currency', 'currency')}
          {field('Latitude', 'latitude', 'number')}
          {field('Longitude', 'longitude', 'number')}
          {field('Sum Insured (TSI)', 'sum_insured', 'number')}
          {field('Share %', 'share_pct', 'number')}
          {field('Share Amount', 'share_amount', 'number')}
          {field('Premi', 'premium', 'number')}
          {field('Klaim', 'claim_amount', 'number')}
          {field('Inception (YYYY-MM-DD)', 'inception_date')}
          {field('Expiry (YYYY-MM-DD)', 'expiry_date')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Batal
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import {
  deletePersonalAsset,
  getPersonalAssetRisk,
  getPersonalAssets,
  type PersonalAsset,
  type PersonalAssetRisk,
} from '../../lib/api/client'
import { formatIDRCompact } from './format'
import PersonalAssetFormModal from './PersonalAssetFormModal'

const categoryLabels: Record<string, string> = {
  home: 'Rumah',
  building: 'Bangunan',
  vehicle: 'Kendaraan',
  business: 'Tempat usaha',
  land: 'Tanah',
  other: 'Lainnya',
}

export default function PersonalAssetsPage() {
  const [assets, setAssets] = useState<PersonalAsset[]>([])
  const [limit, setLimit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PersonalAsset | undefined>()
  const [formOpen, setFormOpen] = useState(false)
  const [riskByAsset, setRiskByAsset] = useState<Record<string, PersonalAssetRisk>>({})
  const [riskLoading, setRiskLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getPersonalAssets()
      setAssets(response.data)
      setLimit(response.meta.limit)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat aset.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const inspectRisk = async (asset: PersonalAsset) => {
    setRiskLoading(asset.id)
    try {
      const result = await getPersonalAssetRisk(asset.id)
      setRiskByAsset((current) => ({ ...current, [asset.id]: result }))
    } finally {
      setRiskLoading(null)
    }
  }

  const remove = async (asset: PersonalAsset) => {
    if (!window.confirm(`Hapus aset "${asset.name}"?`)) return
    await deletePersonalAsset(asset.id)
    void load()
  }

  const atLimit = limit > 0 && assets.length >= limit

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-slate-50">Aset Saya</h3>
          <p className="mt-1 text-sm text-slate-400">Lokasi privat untuk pemantauan bencana dan peringatan dini.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{assets.length}{limit > 0 ? ` / ${limit}` : ''} aset</span>
          <button
            type="button"
            disabled={atLimit}
            onClick={() => { setEditing(undefined); setFormOpen(true) }}
            className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Tambah aset
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-52 animate-pulse rounded-2xl bg-slate-900" />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center">
          <p className="font-semibold text-slate-200">Belum ada aset pribadi.</p>
          <p className="mt-2 text-sm text-slate-500">Tambahkan rumah, kendaraan, tanah, atau tempat usaha untuk mulai memantau risiko sekitar.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assets.map((asset) => {
            const risk = riskByAsset[asset.id]
            return (
              <article key={asset.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl shadow-slate-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{categoryLabels[asset.category]}</span>
                    <h4 className="mt-2 font-semibold text-slate-50">{asset.name}</h4>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{asset.address || 'Alamat ditentukan dari pin peta'}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${asset.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                    {asset.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-950/60 p-2">
                    <p className="text-slate-500">Koordinat</p>
                    <p className="mt-1 font-mono text-slate-300">{asset.latitude.toFixed(4)}, {asset.longitude.toFixed(4)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/60 p-2">
                    <p className="text-slate-500">Radius alert</p>
                    <p className="mt-1 text-slate-300">{asset.alert_radius_km} km</p>
                  </div>
                </div>
                {asset.estimated_value != null && <p className="mt-3 text-xs text-slate-400">Estimasi privat: {formatIDRCompact(asset.estimated_value, asset.currency)}</p>}
                {risk && (
                  <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs">
                    <p className="font-semibold text-amber-200">{risk.nearby_event_count} kejadian dalam radius</p>
                    <p className="mt-1 text-slate-400">{risk.active_alert_count} memerlukan perhatian · dinilai {new Date(risk.assessed_at).toLocaleString('id-ID')}</p>
                    <p className="mt-2 text-[10px] text-slate-500">{risk.status_note}</p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
                  <button type="button" onClick={() => inspectRisk(asset)} disabled={riskLoading === asset.id} className="text-amber-300 hover:text-amber-200 disabled:opacity-50">
                    {riskLoading === asset.id ? 'Menganalisis…' : 'Analisis risiko'}
                  </button>
                  <button type="button" onClick={() => { setEditing(asset); setFormOpen(true) }} className="text-indigo-300 hover:text-indigo-200">Edit</button>
                  <button type="button" onClick={() => remove(asset)} className="text-rose-300 hover:text-rose-200">Hapus</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {formOpen && (
        <PersonalAssetFormModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load() }}
        />
      )}
    </div>
  )
}

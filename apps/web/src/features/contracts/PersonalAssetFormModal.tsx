import { useState } from 'react'
import WatchZoneMapPicker from '../ews/WatchZoneMapPicker'
import {
  createPersonalAsset,
  searchAddress,
  updatePersonalAsset,
  type GeocodingResult,
  type PersonalAsset,
  type PersonalAssetCategory,
  type PersonalAssetInput,
} from '../../lib/api/client'

const categories: Array<{ value: PersonalAssetCategory; label: string }> = [
  { value: 'home', label: 'Rumah' },
  { value: 'building', label: 'Bangunan' },
  { value: 'vehicle', label: 'Kendaraan' },
  { value: 'business', label: 'Tempat usaha' },
  { value: 'land', label: 'Tanah' },
  { value: 'other', label: 'Lainnya' },
]
const perils = ['earthquake', 'flood', 'volcano', 'wildfire', 'windstorm']
const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400'

type Props = {
  initial?: PersonalAsset
  onClose: () => void
  onSaved: () => void
}

export default function PersonalAssetFormModal({ initial, onClose, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<PersonalAssetCategory>(initial?.category ?? 'home')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [latitude, setLatitude] = useState<number | null>(initial?.latitude ?? null)
  const [longitude, setLongitude] = useState<number | null>(initial?.longitude ?? null)
  const [radius, setRadius] = useState(initial?.alert_radius_km ?? 25)
  const [selectedPerils, setSelectedPerils] = useState<string[]>(initial?.peril_types ?? [])
  const [estimatedValue, setEstimatedValue] = useState(initial?.estimated_value?.toString() ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const findAddress = async () => {
    if (address.trim().length < 3) {
      setError('Masukkan minimal 3 karakter alamat.')
      return
    }
    setSearching(true)
    setError(null)
    try {
      setResults(await searchAddress(address.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pencarian alamat gagal. Pilih titik secara manual.')
    } finally {
      setSearching(false)
    }
  }

  const chooseResult = (result: GeocodingResult) => {
    setAddress(result.label)
    setLatitude(result.latitude)
    setLongitude(result.longitude)
    setResults([])
  }

  const save = async () => {
    if (!name.trim() || latitude === null || longitude === null) {
      setError('Nama aset dan titik peta wajib diisi.')
      return
    }
    const value = estimatedValue.trim() === '' ? null : Number(estimatedValue)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('Estimasi nilai aset tidak valid.')
      return
    }
    const body: PersonalAssetInput = {
      name: name.trim(),
      category,
      address: address.trim(),
      latitude,
      longitude,
      estimated_value: value,
      currency: 'IDR',
      notes: notes.trim(),
      peril_types: selectedPerils,
      alert_radius_km: radius,
      thresholds: {},
      is_active: initial?.is_active ?? true,
    }
    setSaving(true)
    setError(null)
    try {
      if (initial) await updatePersonalAsset(initial.id, body)
      else await createPersonalAsset(body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan aset.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-50">{initial ? 'Edit Aset' : 'Tambah Aset Saya'}</h3>
            <p className="mt-1 text-xs text-slate-500">Cari alamat, lalu konfirmasi lokasi dengan memindahkan pin.</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-100">Tutup</button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-slate-400">
            Nama aset
            <input className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Rumah keluarga" />
          </label>
          <label className="text-xs text-slate-400">
            Kategori
            <select className={`${inputClass} mt-1`} value={category} onChange={(event) => setCategory(event.target.value as PersonalAssetCategory)}>
              {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        <div className="relative mt-4">
          <label className="text-xs text-slate-400">
            Alamat
            <div className="mt-1 flex gap-2">
              <input className={inputClass} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Cari alamat di Indonesia" />
              <button type="button" onClick={findAddress} disabled={searching} className="shrink-0 rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-4 text-sm font-semibold text-indigo-200 disabled:opacity-50">
                {searching ? 'Mencari…' : 'Cari'}
              </button>
            </div>
          </label>
          {results.length > 0 && (
            <div className="absolute z-[1100] mt-2 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
              {results.map((result) => (
                <button key={`${result.latitude}-${result.longitude}`} type="button" onClick={() => chooseResult(result)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                  {result.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <WatchZoneMapPicker
            latitude={latitude}
            longitude={longitude}
            radiusKm={radius}
            onChange={(lat, lon, nextRadius) => {
              setLatitude(lat)
              setLongitude(lon)
              setRadius(nextRadius)
            }}
          />
        </div>

        <div className="mt-4">
          <p className="text-xs text-slate-400">Bencana yang dipantau</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {perils.map((peril) => {
              const selected = selectedPerils.includes(peril)
              return (
                <button
                  key={peril}
                  type="button"
                  onClick={() => setSelectedPerils((current) => selected ? current.filter((item) => item !== peril) : [...current, peril])}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${selected ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/40' : 'bg-slate-800 text-slate-400'}`}
                >
                  {peril}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Tanpa pilihan berarti seluruh jenis bencana dipantau.</p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-slate-400">
            Estimasi nilai aset (opsional)
            <input type="number" min="0" className={`${inputClass} mt-1`} value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} placeholder="IDR" />
          </label>
          <label className="text-xs text-slate-400">
            Catatan privat
            <input className={`${inputClass} mt-1`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">Batal</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:opacity-50">
            {saving ? 'Menyimpan…' : 'Simpan aset'}
          </button>
        </div>
      </div>
    </div>
  )
}

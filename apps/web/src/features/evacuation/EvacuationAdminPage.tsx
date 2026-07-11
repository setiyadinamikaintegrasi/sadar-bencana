import { useCallback, useEffect, useState } from 'react'
import {
  createEvacuationLocation,
  deleteEvacuationLocation,
  fetchAllEvacuationLocationsAdmin,
  importEvacuationCSV,
  updateEvacuationLocation,
  uploadEvacuationPhoto,
  EVACUATION_TYPE_META,
  type EvacuationLocation,
  type EvacuationLocationInput,
  type EvacuationLocationType,
} from '../../lib/api/evacuation'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from '../ews/LoginGate'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

const emptyForm: EvacuationLocationInput = {
  name: '', location_type: 'titik_kumpul', latitude: 0, longitude: 0,
  address: '', photo_url: '', capacity: null, is_open: null, is_full: null,
  phone: '', person_in_charge: '', facilities: [], operating_hours: '',
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400'

function triState(value: boolean | null | undefined): string {
  return value === true ? 'ya' : value === false ? 'tidak' : 'unknown'
}
function fromTriState(raw: string): boolean | null {
  return raw === 'ya' ? true : raw === 'tidak' ? false : null
}

function toInput(loc: EvacuationLocation): EvacuationLocationInput {
  return {
    name: loc.name, location_type: loc.location_type,
    latitude: loc.latitude, longitude: loc.longitude,
    address: loc.address, photo_url: loc.photo_url,
    capacity: loc.capacity, is_open: loc.is_open, is_full: loc.is_full,
    phone: loc.phone, person_in_charge: loc.person_in_charge,
    facilities: loc.facilities, operating_hours: loc.operating_hours,
    is_active: loc.is_active,
  }
}

export default function EvacuationAdminPage() {
  const { session, loading } = useAuth()
  const [locations, setLocations] = useState<EvacuationLocation[]>([])
  const [form, setForm] = useState<EvacuationLocationInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLocations(await fetchAllEvacuationLocationsAdmin())
    } catch {
      setError('Gagal memuat daftar lokasi.')
    }
  }, [])

  useEffect(() => {
    if (session) void load()
  }, [session, load])

  if (loading) return <p className="py-12 text-center text-sm text-slate-400">Memeriksa sesi…</p>
  if (!session)
    return (
      <LoginGate
        title="Admin Lokasi Evakuasi"
        subtitleIn="Masuk dengan akun admin untuk mengelola lokasi evakuasi."
        subtitleUp="Akses halaman ini hanya untuk administrator."
      />
    )

  const fail = (e: unknown) => {
    const status = (e as { status?: number }).status
    setError(
      status === 403
        ? 'Akses admin diperlukan untuk mengelola lokasi evakuasi.'
        : e instanceof Error
          ? e.message
          : 'Operasi gagal.',
    )
  }

  const submit = async () => {
    setBusy(true); setError(null); setMessage(null)
    try {
      if (editingId) {
        await updateEvacuationLocation(editingId, form)
        setMessage('Lokasi diperbarui.')
      } else {
        await createEvacuationLocation(form)
        setMessage('Lokasi ditambahkan.')
      }
      setForm(emptyForm); setEditingId(null)
      await load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Nonaktifkan lokasi ini?')) return
    setBusy(true); setError(null)
    try { await deleteEvacuationLocation(id); await load() } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const reactivate = async (loc: EvacuationLocation) => {
    setBusy(true); setError(null); setMessage(null)
    try {
      await updateEvacuationLocation(loc.id, { ...toInput(loc), is_active: true })
      setMessage('Lokasi diaktifkan kembali.')
      await load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const onCSV = async (file: File) => {
    setBusy(true); setError(null); setMessage(null)
    try {
      const { inserted } = await importEvacuationCSV(file)
      setMessage(`${inserted} lokasi berhasil diimpor.`)
      await load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const onPhoto = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const url = await uploadEvacuationPhoto(file)
      setForm((f) => ({ ...f, photo_url: url }))
      setMessage('Foto terunggah.')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Admin Lokasi Evakuasi</h1>
        <p className="text-sm text-slate-400">
          Kelola shelter/TES/TEA/posko/titik kumpul. Fasilitas umum (RS, puskesmas, polisi, damkar)
          tersinkron otomatis dari OpenStreetMap.
        </p>
      </div>

      {message && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-200">{editingId ? 'Edit Lokasi' : 'Tambah Lokasi'}</h2>
          <input className={inputCls} placeholder="Nama lokasi" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputCls} value={form.location_type}
            onChange={(e) => setForm({ ...form, location_type: e.target.value as EvacuationLocationType })}>
            {(Object.keys(EVACUATION_TYPE_META) as EvacuationLocationType[]).map((t) => (
              <option key={t} value={t}>{EVACUATION_TYPE_META[t].label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} type="number" step="any" placeholder="Latitude" value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })} />
            <input className={inputCls} type="number" step="any" placeholder="Longitude" value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })} />
          </div>
          <input className={inputCls} placeholder="Alamat" value={form.address ?? ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <input className={inputCls} type="number" min="0" placeholder="Kapasitas" value={form.capacity ?? ''}
              onChange={(e) => setForm({ ...form, capacity: e.target.value === '' ? null : Number(e.target.value) })} />
            <select className={inputCls} value={triState(form.is_open)}
              onChange={(e) => setForm({ ...form, is_open: fromTriState(e.target.value) })}>
              <option value="unknown">Buka? (tidak tahu)</option>
              <option value="ya">Buka</option>
              <option value="tidak">Tutup</option>
            </select>
            <select className={inputCls} value={triState(form.is_full)}
              onChange={(e) => setForm({ ...form, is_full: fromTriState(e.target.value) })}>
              <option value="unknown">Penuh? (tidak tahu)</option>
              <option value="ya">Penuh</option>
              <option value="tidak">Tersedia</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Telepon" value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={inputCls} placeholder="Penanggung jawab" value={form.person_in_charge ?? ''}
              onChange={(e) => setForm({ ...form, person_in_charge: e.target.value })} />
          </div>
          <input className={inputCls} placeholder="Fasilitas (pisahkan koma)" value={(form.facilities ?? []).join(', ')}
            onChange={(e) =>
              setForm({ ...form, facilities: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
            } />
          <input className={inputCls} placeholder="Jam operasional (mis. 24 jam)" value={form.operating_hours ?? ''}
            onChange={(e) => setForm({ ...form, operating_hours: e.target.value })} />
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-700">
              {form.photo_url ? 'Ganti Foto' : 'Upload Foto'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => e.target.files?.[0] && void onPhoto(e.target.files[0])} />
            </label>
            {form.photo_url && <img src={form.photo_url} alt="pratinjau" className="h-10 w-10 rounded object-cover" />}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={busy || !form.name}
              className="rounded-lg bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 ring-1 ring-inset ring-indigo-400/40 hover:bg-indigo-500/30 disabled:opacity-50">
              {editingId ? 'Simpan Perubahan' : 'Tambah Lokasi'}
            </button>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm) }}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
                Batal
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Import CSV</h2>
            <p className="text-xs text-slate-500">
              Unduh <a className="text-indigo-300 hover:underline" href={`${BASE_URL}/evacuation-locations/import/template`}>template CSV</a>,
              isi, lalu unggah. Import bersifat all-or-nothing.
            </p>
            <label className="inline-block cursor-pointer rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-700">
              Pilih file CSV
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && void onCSV(e.target.files[0])} />
            </label>
          </div>

          <div className="max-h-[480px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Daftar Lokasi ({locations.length})</h2>
            <ul className="divide-y divide-slate-800">
              {locations.map((loc) => (
                <li key={loc.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">{loc.name}</p>
                    <p className="text-xs text-slate-500">
                      {EVACUATION_TYPE_META[loc.location_type].label} · {loc.source_type}
                      {!loc.is_active && (
                        <span className="ml-2 rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300 ring-1 ring-inset ring-rose-500/40">
                          Nonaktif
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button type="button" className="text-indigo-300 hover:underline"
                      onClick={() => {
                        setEditingId(loc.id)
                        setForm(toInput(loc))
                      }}>
                      Edit
                    </button>
                    {loc.is_active ? (
                      <button type="button" className="text-rose-300 hover:underline" onClick={() => void remove(loc.id)}>
                        Hapus
                      </button>
                    ) : (
                      <button type="button" className="text-emerald-300 hover:underline" onClick={() => void reactivate(loc)}>
                        Aktifkan Kembali
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

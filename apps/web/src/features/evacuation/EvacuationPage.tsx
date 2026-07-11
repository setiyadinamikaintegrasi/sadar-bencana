import { useCallback, useEffect, useState } from 'react'
import EvacuationMap from './EvacuationMap'
import NearestSafePlacePanel from './NearestSafePlacePanel'
import EvacuationLocationDetail from './EvacuationLocationDetail'
import {
  fetchEvacuationLocations,
  fetchNearestSafePlaces,
  EVACUATION_TYPE_META,
  type EvacuationLocation,
  type EvacuationLocationType,
  type NearestResponse,
} from '../../lib/api/evacuation'

export default function EvacuationPage() {
  const [locations, setLocations] = useState<EvacuationLocation[]>([])
  const [typeFilter, setTypeFilter] = useState<EvacuationLocationType | 'all'>('all')
  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [nearest, setNearest] = useState<NearestResponse | null>(null)
  const [selected, setSelected] = useState<EvacuationLocation | null>(null)
  const [routeTo, setRouteTo] = useState<[number, number] | null>(null)
  const [manualPinMode, setManualPinMode] = useState(false)
  const [radiusKm, setRadiusKm] = useState(25)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchEvacuationLocations()
      .then(setLocations)
      .catch(() => setError('Gagal memuat lokasi evakuasi.'))
  }, [])

  const search = useCallback(async (lat: number, lon: number, radius: number) => {
    setBusy(true)
    setError(null)
    try {
      setNearest(await fetchNearestSafePlaces({ lat, lon, radiusKm: radius }))
    } catch {
      setError('Pencarian gagal. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }, [])

  const findSafePlace = () => {
    setError(null)
    if (!navigator.geolocation) {
      setManualPinMode(true)
      setError('Browser tidak mendukung geolokasi — ketuk posisi Anda di peta.')
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setUserPos(at)
        setManualPinMode(false)
        void search(at[0], at[1], radiusKm)
      },
      (err) => {
        setBusy(false)
        setManualPinMode(true)
        setError(
          err.code === GeolocationPositionError.PERMISSION_DENIED
            ? 'Izin lokasi ditolak — ketuk posisi Anda di peta untuk mencari tempat aman.'
            : 'Tidak bisa mendapatkan lokasi Anda — coba lagi atau ketuk posisi Anda di peta.',
        )
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const onMapClick = (lat: number, lon: number) => {
    if (!manualPinMode) return
    setUserPos([lat, lon])
    setManualPinMode(false)
    void search(lat, lon, radiusKm)
  }

  const widenRadius = () => {
    const next = Math.min(radiusKm * 2, 100)
    setRadiusKm(next)
    if (userPos) void search(userPos[0], userPos[1], next)
  }

  const filtered = typeFilter === 'all' ? locations : locations.filter((l) => l.location_type === typeFilter)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Lokasi Evakuasi</h1>
          <p className="text-sm text-slate-400">
            Temukan shelter, titik kumpul, dan fasilitas darurat terdekat. Tetap ikuti arahan resmi
            BMKG/BNPB/BPBD.
          </p>
        </div>
        <button
          type="button"
          onClick={findSafePlace}
          disabled={busy}
          className="rounded-xl bg-emerald-500/20 px-5 py-2.5 text-sm font-bold text-emerald-100 ring-1 ring-inset ring-emerald-400/50 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {busy ? 'Mencari…' : '⛑ Cari Tempat Aman'}
        </button>
      </div>

      {error && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{error}</p>}
      {manualPinMode && (
        <p className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
          Mode pin manual aktif — ketuk peta untuk menandai posisi Anda.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTypeFilter('all')}
          className={`rounded-full px-3 py-1 text-xs ${typeFilter === 'all' ? 'bg-indigo-500/30 text-indigo-100' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
        >
          Semua
        </button>
        {(Object.keys(EVACUATION_TYPE_META) as EvacuationLocationType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`rounded-full px-3 py-1 text-xs ${typeFilter === t ? 'bg-indigo-500/30 text-indigo-100' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            {EVACUATION_TYPE_META[t].glyph} {EVACUATION_TYPE_META[t].label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <EvacuationMap
          locations={filtered}
          userPos={userPos}
          routeTo={routeTo}
          manualPinMode={manualPinMode}
          onMapClick={onMapClick}
          onSelect={(loc) => {
            setSelected(loc)
            setRouteTo(null)
          }}
        />
        <div className="space-y-4">
          {selected && (
            <EvacuationLocationDetail
              location={selected}
              onClose={() => {
                setSelected(null)
                setRouteTo(null)
              }}
              onNavigateInternal={() => {
                if (!userPos) {
                  setManualPinMode(true)
                  setError('Tandai dulu posisi Anda (ketuk peta) untuk melihat rute.')
                  return
                }
                setRouteTo([selected.latitude, selected.longitude])
              }}
            />
          )}
          {nearest && !selected && (
            <NearestSafePlacePanel
              response={nearest}
              onSelect={(place) => {
                setSelected(place)
                setRouteTo([place.latitude, place.longitude])
              }}
              onWidenRadius={widenRadius}
            />
          )}
          {!nearest && !selected && (
            <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
              Tekan <b>Cari Tempat Aman</b> untuk menemukan lokasi evakuasi terdekat dari posisi Anda.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { EVACUATION_TYPE_META, type NearestResponse, type NearestSafePlace } from '../../lib/api/evacuation'

const DISASTER_LABELS: Record<string, string> = {
  earthquake: 'Gempa', tsunami: 'Tsunami', flood: 'Banjir',
  landslide: 'Longsor', volcano: 'Gunung Api', fire: 'Kebakaran', wildfire: 'Karhutla',
}

type PanelProps = {
  response: NearestResponse
  onSelect: (place: NearestSafePlace) => void
  onWidenRadius: () => void
}

export default function NearestSafePlacePanel({ response, onSelect, onWidenRadius }: PanelProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {response.detection === 'auto' && response.disaster_type && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Terdeteksi kejadian <b>{DISASTER_LABELS[response.disaster_type] ?? response.disaster_type}</b> di
          sekitar Anda — hasil difilter ke lokasi prioritas untuk jenis bencana ini.
        </div>
      )}
      <p className="text-xs text-slate-500">{response.status_note}</p>
      {response.results.length === 0 ? (
        <div className="space-y-2 py-6 text-center">
          <p className="text-sm text-slate-400">
            Tidak ada lokasi evakuasi terdaftar dalam radius {response.radius_km} km.
          </p>
          {response.radius_km < 100 && (
            <button
              type="button"
              onClick={onWidenRadius}
              className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 ring-1 ring-inset ring-indigo-400/40 hover:bg-indigo-500/30"
            >
              Perluas radius pencarian
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {response.results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => onSelect(place)}
                className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-slate-800/40"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-100">{place.name}</p>
                  <p className="text-xs text-slate-400">
                    {EVACUATION_TYPE_META[place.location_type].label}
                    {place.capacity != null && <> · kapasitas {place.capacity}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-300">
                  <p className="font-semibold">{place.distance_km.toFixed(1)} km</p>
                  <p className="text-slate-500">🚶 {place.walk_minutes} mnt · 🚗 {place.drive_minutes} mnt</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

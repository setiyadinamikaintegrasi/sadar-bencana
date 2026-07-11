import { EVACUATION_TYPE_META, type EvacuationLocation } from '../../lib/api/evacuation'

type DetailProps = {
  location: EvacuationLocation
  onClose: () => void
  onNavigateInternal: () => void
}

function statusBadge(location: EvacuationLocation) {
  if (location.is_open === false) return { text: 'Tutup', cls: 'bg-slate-500/20 text-slate-300' }
  if (location.is_open === null) return { text: 'Status tidak diketahui', cls: 'bg-slate-500/20 text-slate-400' }
  if (location.is_full === true) return { text: 'Buka · Penuh', cls: 'bg-amber-500/20 text-amber-200' }
  return { text: 'Buka · Tersedia', cls: 'bg-emerald-500/20 text-emerald-200' }
}

export default function EvacuationLocationDetail({ location, onClose, onNavigateInternal }: DetailProps) {
  const badge = statusBadge(location)
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`
  const waze = `https://waze.com/ul?ll=${location.latitude},${location.longitude}&navigate=yes`
  const linkCls =
    'flex-1 rounded-lg bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-slate-100 ring-1 ring-inset ring-slate-700 hover:bg-slate-700'
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-50">{location.name}</h3>
          <p className="text-xs text-slate-400">{EVACUATION_TYPE_META[location.location_type].label}</p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
      </div>
      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
      {location.photo_url && (
        <img src={location.photo_url} alt={location.name} className="max-h-48 w-full rounded-xl object-cover" />
      )}
      <dl className="space-y-1.5 text-xs">
        {location.address && <div><dt className="inline text-slate-500">Alamat: </dt><dd className="inline text-slate-300">{location.address}</dd></div>}
        {location.capacity != null && <div><dt className="inline text-slate-500">Kapasitas: </dt><dd className="inline text-slate-300">{location.capacity} orang</dd></div>}
        {location.phone && <div><dt className="inline text-slate-500">Telepon: </dt><dd className="inline"><a className="text-indigo-300 hover:underline" href={`tel:${location.phone}`}>{location.phone}</a></dd></div>}
        {location.person_in_charge && <div><dt className="inline text-slate-500">Penanggung jawab: </dt><dd className="inline text-slate-300">{location.person_in_charge}</dd></div>}
        {location.operating_hours && <div><dt className="inline text-slate-500">Jam operasional: </dt><dd className="inline text-slate-300">{location.operating_hours}</dd></div>}
        {location.facilities.length > 0 && <div><dt className="inline text-slate-500">Fasilitas: </dt><dd className="inline text-slate-300">{location.facilities.join(', ')}</dd></div>}
      </dl>
      <div className="flex gap-2">
        <a className={linkCls} href={gmaps} target="_blank" rel="noopener noreferrer">Google Maps</a>
        <a className={linkCls} href={waze} target="_blank" rel="noopener noreferrer">Waze</a>
        <button type="button" onClick={onNavigateInternal} className={linkCls}>Rute di Peta</button>
      </div>
    </div>
  )
}

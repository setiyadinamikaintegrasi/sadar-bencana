import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import Supercluster from 'supercluster'
import { getContracts, type AcceptanceContract } from '../lib/api/client'
import { PERIL_COLORS, PERIL_LABELS, formatIDRCompact } from '../features/contracts/format'

type Props = { active: boolean }

function markerSize(shareAmount: number): number {
  // log scale: ~18px small, ~40px large
  const v = Math.max(shareAmount, 1)
  return Math.max(16, Math.min(40, 8 + Math.log10(v) * 3))
}

function objectIcon(c: AcceptanceContract): L.DivIcon {
  const size = markerSize(c.share_amount)
  const color = PERIL_COLORS[c.peril] ?? PERIL_COLORS.other
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};opacity:0.85;border:1px solid rgba(255,255,255,0.5);box-shadow:0 4px 12px rgba(0,0,0,0.4)"></div>`,
  })
}

function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 30 : count < 50 ? 38 : 46
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:rgba(99,102,241,0.35);border:1px solid rgba(165,180,252,0.7);color:#e0e7ff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${count}</div>`,
  })
}

export default function RiskLayer({ active }: Props) {
  const map = useMap()
  const [contracts, setContracts] = useState<AcceptanceContract[]>([])
  const [bounds, setBounds] = useState(() => map.getBounds())

  useMapEvents({
    moveend: () => setBounds(map.getBounds()),
    zoomend: () => setBounds(map.getBounds()),
  })

  useEffect(() => {
    if (!active) return
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`
    let cancelled = false
    getContracts({ bbox, limit: 2000 })
      .then((res) => { if (!cancelled) setContracts(res.data) })
      .catch(() => { if (!cancelled) setContracts([]) })
    return () => { cancelled = true }
  }, [active, bounds])

  const index = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 16 })
    sc.load(
      contracts.map((c) => ({
        type: 'Feature' as const,
        properties: { contract: c },
        geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] },
      })),
    )
    return sc
  }, [contracts])

  if (!active) return null

  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const zoom = Math.round(map.getZoom())
  const clusters = index.getClusters([sw.lng, sw.lat, ne.lng, ne.lat], zoom)

  return (
    <>
      {clusters.map((cl) => {
        const [lng, lat] = cl.geometry.coordinates
        if (cl.properties.cluster) {
          const count = cl.properties.point_count as number
          return (
            <Marker
              key={`cl-${cl.id}`}
              position={[lat, lng]}
              icon={clusterIcon(count)}
              eventHandlers={{
                click: () => {
                  const expansionZoom = Math.min(index.getClusterExpansionZoom(cl.id as number), 16)
                  map.flyTo([lat, lng], expansionZoom, { animate: true })
                },
              }}
            />
          )
        }
        const c = cl.properties.contract as AcceptanceContract
        return (
          <Marker key={`obj-${c.id}`} position={[lat, lng]} icon={objectIcon(c)}>
            <Popup>
              <div style={{ minWidth: '200px' }}>
                <strong>{c.object_name || c.contract_no}</strong>
                <br />
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>{c.cedant_name}</span>
                <br />
                <span>{PERIL_LABELS[c.peril]} · {c.treaty_type}</span>
                <br />
                <span style={{ fontSize: '12px' }}>
                  TSI {formatIDRCompact(c.sum_insured, c.currency)} · Share {formatIDRCompact(c.share_amount, c.currency)}
                </span>
                <br />
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Premi {formatIDRCompact(c.premium, c.currency)} · Klaim {formatIDRCompact(c.claim_amount, c.currency)}
                </span>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}

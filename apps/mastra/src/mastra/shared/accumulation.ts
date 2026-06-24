import { config } from './config'
import { fetchJson } from './http'
import { eventTypeToPeril } from './peril'

export interface EventAccumulation {
  event_id: string
  place: string | null
  magnitude: number
  peril: string
  radius_km: number
  count: number
  sum_insured: number
  share_amount: number
  premium: number
  claim_amount: number
}

// For the top-N events, accumulate portfolio exposure within radiusKm of each event point.
// Per-event failures degrade to zeroed entries (never reject the whole batch).
export async function accumulationsForEvents(
  events: any[] | undefined,
  topN = 3,
  radiusKm = 50,
): Promise<EventAccumulation[]> {
  const top = (events ?? []).slice(0, topN)
  return Promise.all(
    top.map(async (ev: any): Promise<EventAccumulation> => {
      const peril = eventTypeToPeril(ev?.event_type)
      const base: EventAccumulation = {
        event_id: ev?.event_id ?? '',
        place: ev?.place ?? null,
        magnitude: ev?.magnitude ?? 0,
        peril,
        radius_km: radiusKm,
        count: 0,
        sum_insured: 0,
        share_amount: 0,
        premium: 0,
        claim_amount: 0,
      }
      if (ev?.latitude == null || ev?.longitude == null) return base
      const params = new URLSearchParams({
        lat: String(ev.latitude),
        lon: String(ev.longitude),
        radius_km: String(radiusKm),
        peril,
      })
      if (ev?.event_time) params.set('active_on', String(ev.event_time).slice(0, 10))
      try {
        const res = await fetchJson<any>(`${config.apiBaseUrl}/accumulation?${params.toString()}`)
        const s = res?.data?.summary ?? {}
        return {
          ...base,
          count: s.count ?? 0,
          sum_insured: s.sum_insured ?? 0,
          share_amount: s.share_amount ?? 0,
          premium: s.premium ?? 0,
          claim_amount: s.claim_amount ?? 0,
        }
      } catch {
        return base
      }
    }),
  )
}

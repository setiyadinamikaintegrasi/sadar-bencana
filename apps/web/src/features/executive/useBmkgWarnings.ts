import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getAirQualityObservations,
  getOfficialAlerts,
  type AirQualityObservation,
  type AirQualityObservationsResponse,
  type OfficialAlert,
} from '../../lib/api/client'
import { filterActiveOfficialAlerts, unpackBmkgResults } from './bmkgPresentation'

export const BMKG_REFRESH_INTERVAL_MS = 60_000

type EndpointStatus = {
  loaded: boolean
  uncertain: boolean
}

export type BmkgEndpointStatuses = {
  weather: EndpointStatus
  air_quality: EndpointStatus
  observations: EndpointStatus
}

type UseBmkgWarningsOptions = {
  fetchWeather?: () => Promise<OfficialAlert[]>
  fetchAirQualityAlerts?: () => Promise<OfficialAlert[]>
  fetchObservations?: () => Promise<AirQualityObservationsResponse>
  refreshIntervalMs?: number
}

type BmkgState = {
  weatherAlerts: OfficialAlert[]
  airQualityAlerts: OfficialAlert[]
  observations: AirQualityObservation[]
  sourceActive: boolean | null
  errors: Record<string, string>
  loading: boolean
  status: BmkgEndpointStatuses
}

const initialStatus: BmkgEndpointStatuses = {
  weather: { loaded: false, uncertain: false },
  air_quality: { loaded: false, uncertain: false },
  observations: { loaded: false, uncertain: false },
}

const initialState: BmkgState = {
  weatherAlerts: [],
  airQualityAlerts: [],
  observations: [],
  sourceActive: null,
  errors: {},
  loading: true,
  status: initialStatus,
}

const defaultFetchWeather = () => getOfficialAlerts('bmkg_cap')
const defaultFetchAirQualityAlerts = () => getOfficialAlerts('bmkg_air_quality')

export function useBmkgWarnings({
  fetchWeather = defaultFetchWeather,
  fetchAirQualityAlerts = defaultFetchAirQualityAlerts,
  fetchObservations = getAirQualityObservations,
  refreshIntervalMs = BMKG_REFRESH_INTERVAL_MS,
}: UseBmkgWarningsOptions = {}) {
  const [state, setState] = useState<BmkgState>(initialState)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)

  const reload = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current

    const request = Promise.allSettled([
      fetchWeather(),
      fetchAirQualityAlerts(),
      fetchObservations(),
    ] as const).then((settled) => {
      if (!mounted.current) return
      const result = unpackBmkgResults(settled)
      setState((current) => ({
        weatherAlerts: result.weatherAlerts ?? current.weatherAlerts,
        airQualityAlerts: result.airQualityAlerts ?? current.airQualityAlerts,
        observations: result.observationsResponse?.data ?? current.observations,
        sourceActive: result.observationsResponse?.meta.source_active ?? current.sourceActive,
        errors: result.errors,
        loading: false,
        status: {
          weather: result.weatherAlerts
            ? { loaded: true, uncertain: false }
            : { ...current.status.weather, uncertain: current.status.weather.loaded },
          air_quality: result.airQualityAlerts
            ? { loaded: true, uncertain: false }
            : { ...current.status.air_quality, uncertain: current.status.air_quality.loaded },
          observations: result.observationsResponse
            ? { loaded: true, uncertain: false }
            : { ...current.status.observations, uncertain: current.status.observations.loaded },
        },
      }))
    }).finally(() => {
      if (inFlight.current === request) inFlight.current = null
    })

    inFlight.current = request
    return request
  }, [fetchAirQualityAlerts, fetchObservations, fetchWeather])

  useEffect(() => {
    mounted.current = true
    void reload()
    const interval = window.setInterval(() => {
      setNow(Date.now())
      void reload()
    }, refreshIntervalMs)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
    }
  }, [refreshIntervalMs, reload])

  const weatherAlerts = useMemo(
    () => filterActiveOfficialAlerts(state.weatherAlerts, now),
    [now, state.weatherAlerts],
  )
  const airQualityAlerts = useMemo(
    () => filterActiveOfficialAlerts(state.airQualityAlerts, now),
    [now, state.airQualityAlerts],
  )

  return {
    ...state,
    weatherAlerts,
    airQualityAlerts,
    now,
    reload,
  }
}

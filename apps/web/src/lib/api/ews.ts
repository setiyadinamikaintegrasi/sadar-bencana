import { request } from './client'

// ── Types ──

export interface EWSSubscriber {
  id: string
  name: string
  email?: string | null
  phone_whatsapp?: string | null
  telegram_chat_id?: number | null
  role: string
  is_active: boolean
  created_at: string
}

export interface EWSWatchZone {
  id: string
  subscriber_id: string
  label: string
  latitude: number
  longitude: number
  radius_km: number
  peril_types: string[]
  thresholds: EWSPerilThresholds
  /** Deprecated compatibility field for clients created before schema 020. */
  min_magnitude?: number | null
  is_active: boolean
}

export interface EWSPerilThresholds {
  earthquake?: { min_magnitude?: number }
  flood?: { min_depth_cm?: number }
  volcano?: { min_activity_level?: number }
  wildfire?: { min_frp?: number }
}

export type EWSChannel = 'telegram' | 'whatsapp' | 'email'
export type EWSSeverity = 'Moderate' | 'High' | 'Critical'

export interface EWSNotificationPref {
  channel: EWSChannel
  min_severity: EWSSeverity
  alert_types: string[]
  quiet_hours_start?: string | null
  quiet_hours_end?: string | null
  is_enabled: boolean
}

export interface EWSNotificationLogEntry {
  id: string
  subscriber_id: string
  subscriber_name?: string | null
  alert_id?: string | null
  channel: EWSChannel
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  error_message?: string | null
  sent_at?: string | null
  created_at: string
}

type ListResponse<T> = { data: T[]; meta: { count: number } }
type ItemResponse<T> = { data: T }

// ── Subscriber API ──

export async function fetchSubscribers(isActive?: boolean): Promise<EWSSubscriber[]> {
  const qs = isActive === undefined ? '' : `?is_active=${isActive}`
  const res = await request<ListResponse<EWSSubscriber>>(`/ews/subscribers${qs}`)
  return res.data
}

export async function createSubscriber(
  data: Partial<EWSSubscriber>,
): Promise<EWSSubscriber> {
  const res = await request<ItemResponse<EWSSubscriber>>('/ews/subscribers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.data
}

export async function updateSubscriber(
  id: string,
  data: Partial<EWSSubscriber>,
): Promise<EWSSubscriber> {
  const res = await request<ItemResponse<EWSSubscriber>>(
    `/ews/subscribers/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.data
}

export async function deleteSubscriber(id: string): Promise<void> {
  await request(`/ews/subscribers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── Watch Zone API ──

export async function fetchWatchZones(subscriberId: string): Promise<EWSWatchZone[]> {
  const res = await request<ListResponse<EWSWatchZone>>(
    `/ews/subscribers/${encodeURIComponent(subscriberId)}/watch-zones`,
  )
  return res.data
}

export async function createWatchZone(
  subscriberId: string,
  data: Partial<EWSWatchZone>,
): Promise<EWSWatchZone> {
  const res = await request<ItemResponse<EWSWatchZone>>(
    `/ews/subscribers/${encodeURIComponent(subscriberId)}/watch-zones`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.data
}

export async function updateWatchZone(
  id: string,
  data: Partial<EWSWatchZone>,
): Promise<EWSWatchZone> {
  const res = await request<ItemResponse<EWSWatchZone>>(
    `/ews/watch-zones/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.data
}

export async function deleteWatchZone(id: string): Promise<void> {
  await request(`/ews/watch-zones/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── Notification Preferences API ──

export async function fetchNotificationPrefs(
  subscriberId: string,
): Promise<EWSNotificationPref[]> {
  const res = await request<ListResponse<EWSNotificationPref>>(
    `/ews/subscribers/${encodeURIComponent(subscriberId)}/preferences`,
  )
  return res.data
}

export async function updateNotificationPrefs(
  subscriberId: string,
  data: Partial<EWSNotificationPref> & { channel: EWSChannel },
): Promise<EWSNotificationPref> {
  const res = await request<ItemResponse<EWSNotificationPref>>(
    `/ews/subscribers/${encodeURIComponent(subscriberId)}/preferences`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.data
}

// ── Notification Log API ──

export interface NotificationLogParams {
  subscriber_id?: string
  channel?: string
  status?: string
  limit?: number
  offset?: number
}

export async function fetchNotificationLog(
  params: NotificationLogParams = {},
): Promise<EWSNotificationLogEntry[]> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== '') qs.set(k, `${v}`)
  })
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await request<ListResponse<EWSNotificationLogEntry>>(
    `/ews/notifications${suffix}`,
  )
  return res.data
}

// ── My profile ──
export async function fetchMyProfile(): Promise<EWSSubscriber> {
  const res = await request<ItemResponse<EWSSubscriber>>('/ews/me')
  return res.data
}
export async function updateMyProfile(
  data: { name?: string; phone_whatsapp?: string | null; telegram_chat_id?: number | null },
): Promise<EWSSubscriber> {
  const res = await request<ItemResponse<EWSSubscriber>>('/ews/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.data
}

// ── My watch zones ──
export async function fetchMyWatchZones(): Promise<EWSWatchZone[]> {
  const res = await request<ListResponse<EWSWatchZone>>('/ews/me/watch-zones')
  return res.data
}
export async function createMyWatchZone(data: Partial<EWSWatchZone>): Promise<EWSWatchZone> {
  const res = await request<ItemResponse<EWSWatchZone>>('/ews/me/watch-zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.data
}
export async function updateMyWatchZone(id: string, data: Partial<EWSWatchZone>): Promise<EWSWatchZone> {
  const res = await request<ItemResponse<EWSWatchZone>>(`/ews/me/watch-zones/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.data
}
export async function deleteMyWatchZone(id: string): Promise<void> {
  await request(`/ews/me/watch-zones/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── My preferences ──
export async function fetchMyPrefs(): Promise<EWSNotificationPref[]> {
  const res = await request<ListResponse<EWSNotificationPref>>('/ews/me/preferences')
  return res.data
}
export async function updateMyPref(
  data: Partial<EWSNotificationPref> & { channel: EWSChannel },
): Promise<EWSNotificationPref> {
  const res = await request<ItemResponse<EWSNotificationPref>>('/ews/me/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.data
}

// ── My notifications (read-only) ──
export async function fetchMyNotifications(): Promise<EWSNotificationLogEntry[]> {
  const res = await request<ListResponse<EWSNotificationLogEntry>>('/ews/me/notifications')
  return res.data
}

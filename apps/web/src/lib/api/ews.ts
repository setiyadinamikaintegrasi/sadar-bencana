import { request } from './client'

// ── Types ──

export interface EWSSubscriber {
  id: string
  name: string
  email?: string | null
  telegram_chat_id?: number | null
  timezone: string
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

export type EWSChannel = 'telegram' | 'email'
export type EWSSeverity = 'Moderate' | 'High' | 'Critical'
export type EWSPerilType = 'weather' | 'air_quality'
export type EWSLifecycleAction = 'alert' | 'update' | 'cancellation' | 'expiry'

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
  status: 'pending' | 'sent' | 'failed' | 'skipped' | 'dead_letter' | 'acknowledged'
  error_message?: string | null
  sent_at?: string | null
  created_at: string
  headline?: string | null
  peril_type?: EWSPerilType | null
  lifecycle_action?: EWSLifecycleAction | null
  matched_watch_zone_label?: string | null
}

export interface EWSSafetyGuidance {
  before: string[]
  during: string[]
  after: string[]
}

export interface EWSActiveWarning {
  id: string
  source: 'bmkg_cap' | 'bmkg_air_quality'
  message_type: 'alert' | 'update' | 'cancel'
  status: 'active' | 'updated' | 'expired' | 'cancelled'
  sent_at: string
  peril_type: EWSPerilType
  severity: EWSSeverity
  category?: string | null
  headline?: string | null
  description?: string | null
  area_name?: string | null
  effective_at?: string | null
  expires_at?: string | null
  source_url?: string | null
  area_geojson?: unknown
  latitude?: number | null
  longitude?: number | null
  matched_watch_zone_ids: string[]
  matched_watch_zone_labels: string[]
  guidance?: EWSSafetyGuidance | null
  guidance_source?: string | null
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
  data: { name?: string; telegram_chat_id?: number | null; timezone?: string },
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

export async function fetchMyActiveWarnings(): Promise<EWSActiveWarning[]> {
  const res = await request<ListResponse<EWSActiveWarning>>('/ews/me/active-warnings')
  return res.data
}

export interface EWSChannelStatus {
  channel: EWSChannel
  provider: string
  configured: boolean
  is_enabled: boolean
  sender?: string
  recipient_configured?: boolean
  has_watch_zone?: boolean
  is_verified?: boolean
  last_success_at?: string | null
  last_failure_at?: string | null
  pending: number
  failed: number
  dead_letter: number
}

export async function fetchMyChannelStatus(): Promise<EWSChannelStatus[]> {
  const res = await request<{ data: EWSChannelStatus[] }>('/ews/me/channels/status')
  return res.data
}

export async function testMyChannel(channel: EWSChannel): Promise<void> {
  await request(`/ews/me/channels/${encodeURIComponent(channel)}/test`, {
    method: 'POST',
  })
}

export async function fetchAdminChannelStatus(): Promise<EWSChannelStatus[]> {
  const res = await request<{ data: EWSChannelStatus[] }>('/ews/channels/status')
  return res.data
}

export async function updateAdminChannel(
  channel: EWSChannel,
  isEnabled: boolean,
): Promise<void> {
  await request(`/ews/channels/${encodeURIComponent(channel)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_enabled: isEnabled }),
  })
}

export interface EWSChannelAuditEntry {
  id: string
  channel: EWSChannel
  previous_enabled: boolean
  new_enabled: boolean
  changed_by: string
  changed_at: string
}

export async function fetchAdminChannelAudit(): Promise<EWSChannelAuditEntry[]> {
  const res = await request<{ data: EWSChannelAuditEntry[] }>('/ews/channels/audit')
  return res.data
}

export async function testSubscriberChannel(
  subscriberId: string,
  channel: EWSChannel,
): Promise<void> {
  await request(
    `/ews/subscribers/${encodeURIComponent(subscriberId)}/channels/${encodeURIComponent(channel)}/test`,
    { method: 'POST' },
  )
}

export async function retryDelivery(deliveryId: string): Promise<void> {
  await request(`/ews/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
    method: 'POST',
  })
}

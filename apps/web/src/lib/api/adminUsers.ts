// apps/web/src/lib/api/adminUsers.ts
import { request } from './client'

export type AdminUser = {
  id: string
  email: string
  email_confirmed_at: string | null
  invited_at: string | null
  last_sign_in_at: string | null
  created_at: string | null
  banned_until: string | null
}

export type AdminUsersResponse = {
  data: AdminUser[]
  meta: { total: number; pages: number; page: number }
}

export async function fetchAdminUsers(query?: string): Promise<AdminUsersResponse> {
  const search = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  return request<AdminUsersResponse>(`/admin/users${search}`)
}

export async function deleteAdminUser(id: string): Promise<void> {
  await request(`/admin/users/${id}`, { method: 'DELETE' })
}

export async function setAdminUserBanned(id: string, banned: boolean): Promise<AdminUser> {
  const response = await request<{ data: AdminUser }>(`/admin/users/${id}/ban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ banned }),
  })
  return response.data
}

export async function resendAdminUserLink(id: string, type: 'magiclink' | 'invite' = 'magiclink'): Promise<{ action_link: string; email: string }> {
  return request<{ action_link: string; email: string }>(`/admin/users/${id}/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  })
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../supabase'
import { activateOfficialSource } from './client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('official source activation API', () => {
  it('sends the approval reference and note as JSON', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await activateOfficialSource('bmkg_air_quality', {
      approval_reference: 'CHG-2026-0715',
      approval_note: 'Approved after worker shadow verification.',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/settings/official-sources/bmkg_air_quality/activate')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      approval_reference: 'CHG-2026-0715',
      approval_note: 'Approved after worker shadow verification.',
    })
  })

  it('rejects blank approval metadata before making a request', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(activateOfficialSource('bmkg_air_quality', {
      approval_reference: '   ',
      approval_note: 'Approved.',
    })).rejects.toThrow('Approval reference dan catatan wajib diisi.')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

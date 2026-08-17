import { describe, expect, it } from 'vitest'
import { SEVERITY_TONES, severityLabel, severityRank, severityTone } from './severityTones'

describe('severityTone', () => {
  it('memetakan nilai event & alert resmi ke tone yang sama', () => {
    expect(severityTone('Critical')).toBe('critical')
    expect(severityTone('extreme')).toBe('critical')
    expect(severityTone('High')).toBe('high')
    expect(severityTone('severe')).toBe('high')
    expect(severityTone('Moderate')).toBe('moderate')
    expect(severityTone('Medium')).toBe('moderate')
    expect(severityTone('Low')).toBe('low')
    expect(severityTone('minor')).toBe('low')
  })

  it('netral untuk nilai kosong/tidak dikenal', () => {
    expect(severityTone(null)).toBe('none')
    expect(severityTone(undefined)).toBe('none')
    expect(severityTone('  ')).toBe('none')
    expect(severityTone('unknown')).toBe('none')
  })
})

describe('severityRank', () => {
  it('urutan rank menaik: none < low < moderate < high < critical', () => {
    expect(severityRank()).toBe(0)
    expect(severityRank('minor')).toBe(1)
    expect(severityRank('Medium')).toBe(2)
    expect(severityRank('severe')).toBe(3)
    expect(severityRank('extreme')).toBe(4)
    expect(severityRank('Critical')).toBe(4)
  })
})

describe('severityLabel', () => {
  it('menampilkan teks asli dengan kapitalisasi rapi', () => {
    expect(severityLabel('critical')).toBe('Critical')
    expect(severityLabel('EXTREME')).toBe('Extreme')
    expect(severityLabel(null)).toBe(SEVERITY_TONES.none.label)
  })
})

describe('SEVERITY_TONES', () => {
  it('hanya critical & high yang punya animasi berkedip', () => {
    expect(SEVERITY_TONES.critical.blink).toContain('severity-blink--critical')
    expect(SEVERITY_TONES.high.blink).toContain('severity-blink--high')
    expect(SEVERITY_TONES.moderate.blink).toBeUndefined()
    expect(SEVERITY_TONES.low.blink).toBeUndefined()
    expect(SEVERITY_TONES.none.blink).toBeUndefined()
  })
})

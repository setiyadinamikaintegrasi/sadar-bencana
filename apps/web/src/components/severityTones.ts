// Tone severity bersama — dipakai badge notifikasi (Tailwind) dan layer peta
// MapLibre (warna hex). Satu sumber kebenaran agar marker peta, kartu alert,
// dan panel dashboard menunjukkan hierarki severity yang konsisten:
// critical/extreme = merah berkedip, high/severe = oranye berkedip,
// moderate = amber statis, low/minor = emerald statis.

export type SeverityTone = 'critical' | 'high' | 'moderate' | 'low' | 'none'

export interface SeverityToneStyle {
  /** Label Indonesia untuk legenda. */
  label: string
  /** Warna hex untuk paint expression MapLibre. */
  color: string
  /** Class Tailwind untuk badge rounded-full. */
  badge: string
  /** Class animasi berkedip — hanya critical & high. */
  blink?: string
  /** Class warna rail kiri kartu notifikasi. */
  rail: string
}

export const SEVERITY_TONES: Record<SeverityTone, SeverityToneStyle> = {
  critical: {
    label: 'Kritis',
    color: '#f43f5e',
    badge: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
    blink: 'severity-blink severity-blink--critical',
    rail: 'bg-rose-500',
  },
  high: {
    label: 'Tinggi',
    color: '#f97316',
    badge: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
    blink: 'severity-blink severity-blink--high',
    rail: 'bg-orange-500',
  },
  moderate: {
    label: 'Sedang',
    color: '#fbbf24',
    badge: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
    rail: 'bg-amber-400',
  },
  low: {
    label: 'Rendah',
    color: '#34d399',
    badge: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
    rail: 'bg-emerald-400',
  },
  none: {
    label: 'Netral',
    color: '#94a3b8',
    badge: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-400/30',
    rail: 'bg-slate-500',
  },
}

/** Normalisasi nilai severity API (event & alert resmi) menjadi tone. */
export function severityTone(severity?: string | null): SeverityTone {
  const value = (severity ?? '').trim().toLowerCase()
  if (value === 'critical' || value === 'extreme') return 'critical'
  if (value === 'high' || value === 'severe') return 'high'
  if (value === 'moderate' || value === 'medium') return 'moderate'
  if (value === 'low' || value === 'minor') return 'low'
  return 'none'
}

/** Rank numerik 0–4 untuk filter/sort/klaster peta (lebih besar = lebih kritis). */
export function severityRank(severity?: string | null): number {
  switch (severityTone(severity)) {
    case 'critical':
      return 4
    case 'high':
      return 3
    case 'moderate':
      return 2
    case 'low':
      return 1
    default:
      return 0
  }
}

/** Label tampilan: pertahankan teks asli (prettify) agar tidak mengubah makna. */
export function severityLabel(severity?: string | null): string {
  const value = (severity ?? '').trim()
  if (!value) return SEVERITY_TONES.none.label
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export const PERIL_LABELS: Record<string, string> = {
  earthquake: 'Gempa',
  flood: 'Banjir',
  volcano: 'Vulkanik',
  fire: 'Kebakaran',
  windstorm: 'Angin Topan',
  other: 'Lainnya',
}

export const PERIL_COLORS: Record<string, string> = {
  earthquake: '#f97316',
  flood: '#38bdf8',
  volcano: '#ef4444',
  fire: '#fb7185',
  windstorm: '#a78bfa',
  other: '#94a3b8',
}

export function formatCurrencyFull(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: currency || 'IDR',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString('id-ID')}`
  }
}

// Compact IDR: 4_200_000_000_000 -> "Rp 4,2 T"
export function formatIDRCompact(value: number, currency = 'IDR'): string {
  const sym = currency === 'IDR' ? 'Rp ' : `${currency} `
  const abs = Math.abs(value)
  const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 })
  if (abs >= 1e12) return `${sym}${fmt(value / 1e12)} T`
  if (abs >= 1e9) return `${sym}${fmt(value / 1e9)} M`
  if (abs >= 1e6) return `${sym}${fmt(value / 1e6)} jt`
  return `${sym}${value.toLocaleString('id-ID')}`
}

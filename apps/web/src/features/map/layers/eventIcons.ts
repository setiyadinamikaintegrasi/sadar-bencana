import type { Map } from 'maplibre-gl'

/**
 * Ikon per jenis bencana untuk layer events MapLibre.
 *
 * Emoji digambar ke canvas sekali per sesi peta lalu didaftarkan sebagai
 * image MapLibre (pixelRatio 2 agar tajam). Aman di jsdom: bila konteks
 * canvas tidak tersedia, pendaftaran dilewati (layer symbol tetap ditambahkan
 * dengan referensi ikon; environment test memock map).
 */

export interface EventPerilIcon {
  imageId: string
  glyph: string
  label: string
}

export const EVENT_PERIL_ICONS: Record<string, EventPerilIcon> = {
  earthquake: { imageId: 'operational-map-event-earthquake', glyph: '💥', label: 'Gempa' },
  wildfire: { imageId: 'operational-map-event-wildfire', glyph: '🔥', label: 'Karhutla' },
  flood: { imageId: 'operational-map-event-flood', glyph: '🌊', label: 'Banjir' },
  volcano: { imageId: 'operational-map-event-volcano', glyph: '🌋', label: 'Vulkanik' },
  wind: { imageId: 'operational-map-event-wind', glyph: '🌀', label: 'Angin/Badai' },
  storm: { imageId: 'operational-map-event-storm', glyph: '🌀', label: 'Angin/Badai' },
  tsunami: { imageId: 'operational-map-event-tsunami', glyph: '🌊', label: 'Tsunami' },
}

export const DEFAULT_EVENT_ICON: EventPerilIcon = {
  imageId: 'operational-map-event-default',
  glyph: '•',
  label: 'Lainnya',
}

/** Daftar unik untuk kunci legenda (label tanpa duplikat). */
export function eventPerilLegend(): Array<EventPerilIcon> {
  const seen = new Set<string>()
  const out: EventPerilIcon[] = []
  for (const icon of [EVENT_PERIL_ICONS.earthquake, EVENT_PERIL_ICONS.wildfire, EVENT_PERIL_ICONS.flood, EVENT_PERIL_ICONS.volcano, EVENT_PERIL_ICONS.wind]) {
    if (seen.has(icon.imageId)) continue
    seen.add(icon.imageId)
    out.push(icon)
  }
  return out
}

function drawGlyphImage(glyph: string, size: number): ImageData | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.font = `${Math.floor(size * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.04)
  try {
    return ctx.getImageData(0, 0, size, size)
  } catch {
    return null
  }
}

/** Daftarkan semua ikon ke map (idempoten; skip bila sudah ada). */
export function registerEventIcons(map: Map): void {
  if (typeof map.addImage !== 'function' || typeof map.hasImage !== 'function') return
  const entries = [...Object.values(EVENT_PERIL_ICONS), DEFAULT_EVENT_ICON]
  for (const icon of entries) {
    if (map.hasImage(icon.imageId)) continue
    const image = drawGlyphImage(icon.glyph, 36)
    if (image) map.addImage(icon.imageId, image, { pixelRatio: 2 })
  }
}

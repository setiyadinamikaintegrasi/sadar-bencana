import type { Map } from 'maplibre-gl'

/**
 * P9 — Export peta sebagai PNG untuk command center / pelaporan.
 *
 * - Membaca kanvas WebGL MapLibre (memerlukan `preserveDrawingBuffer: true`
 *   saat konstruksi peta, jika tidak kanvas terbaca kosong).
 * - Menggambar ulang ke kanvas 2D offscreen + footer atribusi (wajib untuk
 *   lisensi OSM/OpenFreeMap: "© OpenStreetMap contributors").
 * - Unduh via blob URL (CSP-friendly, tidak butuh data: URL).
 *
 * Tombol pemicunya ada di panel legenda (MapLegend), bukan kontrol peta:
 * di layar kecil semua pojok peta terpakai (stack kontrol kanan-atas,
 * timeline replay di strip bawah, legenda kiri-atas) sehingga kontrol peta
 * tambahan tidak bisa ditempatkan tanpa menutupi elemen lain.
 */

const FOOTER_HEIGHT_CSS = 44
const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors · OpenFreeMap'
const BRAND_LABEL = 'Sadar Bencana — Peta Operasional'

export interface MapSnapshotOptions {
  /** Atribusi layer aktif (mis. "BMKG", "The OpenSky Network"). */
  attributions: readonly string[]
  /** Waktu cuplikan — default waktu unduhan. */
  timestamp?: Date
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function pixelRatioFor(canvas: HTMLCanvasElement): number {
  // Resolusi perangkat dihitung dari rasio kanvas terhadap ukuran CSS-nya
  // agar footer tetap tajam di layar retina.
  if (canvas.clientWidth > 0 && canvas.width > 0) return canvas.width / canvas.clientWidth
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/**
 * Gambar ulang kanvas peta ke kanvas 2D baru + footer atribusi.
 * Mengembalikan null bila konteks 2D tidak tersedia (mis. jsdom tanpa canvas).
 */
export function composeMapSnapshot(
  source: HTMLCanvasElement,
  { attributions, timestamp = new Date() }: MapSnapshotOptions,
): HTMLCanvasElement | null {
  const scale = Math.max(1, pixelRatioFor(source))
  const footerHeight = Math.round(FOOTER_HEIGHT_CSS * scale)
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height + footerHeight
  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(source, 0, 0)

  // Footer gelap: brand + waktu (kiri), atribusi (kanan).
  context.fillStyle = 'rgba(15, 23, 42, 0.92)'
  context.fillRect(0, source.height, canvas.width, footerHeight)
  const fontSize = Math.round(12 * scale)
  context.font = `${fontSize}px system-ui, -apple-system, sans-serif`
  context.textBaseline = 'middle'
  const centerY = source.height + footerHeight / 2
  const padding = Math.round(12 * scale)

  const left = `${BRAND_LABEL} · ${timestamp.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
  context.fillStyle = '#e2e8f0'
  context.textAlign = 'left'
  context.fillText(left, padding, centerY)

  const right = [...new Set(attributions), BASEMAP_ATTRIBUTION].join(' · ')
  context.fillStyle = '#94a3b8'
  context.textAlign = 'right'
  const maxRightWidth = canvas.width - padding * 2 - context.measureText(left).width - Math.round(16 * scale)
  const ellipsis = '…'
  let label = right
  while (label.length > 1 && context.measureText(label).width > maxRightWidth) {
    label = label.slice(0, Math.max(1, label.length - 1))
    if (label.length > 1 && context.measureText(label + ellipsis).width <= maxRightWidth) label = label + ellipsis
  }
  if (label.length > 1) context.fillText(label, canvas.width - padding, centerY)

  return canvas
}

/** Unduh cuplikan peta saat ini sebagai PNG. Mengembalikan true bila kanvas berhasil dibaca. */
export function downloadMapSnapshot(map: Map, options: MapSnapshotOptions): boolean {
  const canvas = map.getContainer().querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas')
  if (!canvas || canvas.width === 0 || canvas.height === 0) return false
  const composed = composeMapSnapshot(canvas, options)
  if (!composed) return false

  composed.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sadar-bencana-peta-${formatTimestamp(options.timestamp ?? new Date())}.png`
    anchor.rel = 'noopener'
    anchor.click()
    // Blob URL dicabut setelah unduhan dipicu; beri jeda agar tidak terpotong.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, 'image/png')
  return true
}

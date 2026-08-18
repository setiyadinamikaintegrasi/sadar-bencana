import type { StyleSpecification } from 'maplibre-gl'

/**
 * Patch style gelap OpenFreeMap agar tidak "hitam total".
 *
 * Style dark resmi OpenFreeMap memakai nuansa nyaris seragam (background
 * rgb(12,12,12), laut rgb(27,27,29), daratan rgb(32,32,32)) sehingga
 * daratan/laut/kontur tidak terbedakan. Patch ini menaikkan kontras dengan
 * palet "dark maritime" — konsisten dengan basemap Carto dark yang dipakai
 * fallback Leaflet: laut biru-abu gelap, daratan charcoal lebih terang,
 * jalan & batas wilayah terlihat jelas.
 */

type PaintPatch = Record<string, unknown>

const LAYER_PAINT_PATCHES: Record<string, PaintPatch> = {
  background: { 'background-color': '#11151a' },
  water: { 'fill-color': '#132635', 'fill-outline-color': '#1f3a50' },
  waterway: { 'line-color': '#2a4a5e' },
  landcover_wood: { 'fill-color': '#16211a' },
  landuse_park: { 'fill-color': '#152019' },
  landuse_residential: { 'fill-color': '#16191d' },
  building: { 'fill-color': '#1a1e24', 'fill-outline-color': '#232830' },
  highway_path: { 'line-color': '#2c333b' },
  highway_minor: { 'line-color': '#333b45' },
  'highway_major_casing': { 'line-color': '#3d4653' },
  'highway_major_inner': { 'line-color': '#4a5563' },
  'highway_major_subtle': { 'line-color': '#39424e' },
  'highway_motorway_casing': { 'line-color': '#43506b' },
  'highway_motorway_inner': { 'line-color': '#54648a' },
  'highway_motorway_subtle': { 'line-color': '#3b465c' },
  railway: { 'line-color': '#2e353d' },
  railway_transit: { 'line-color': '#2e353d' },
  boundary_state: { 'line-color': '#4a5462' },
  'boundary_country_z0-4': { 'line-color': '#5b6673' },
  'boundary_country_z5-': { 'line-color': '#5b6673' },
}

/** Terapkan patch warna pada style dark (mutasi in-place pada salinan). */
export function patchDarkStyle(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers ?? []) {
    const patch = LAYER_PAINT_PATCHES[layer.id]
    if (!patch) continue
    layer.paint = { ...(layer.paint ?? {}), ...patch }
  }
  return style
}

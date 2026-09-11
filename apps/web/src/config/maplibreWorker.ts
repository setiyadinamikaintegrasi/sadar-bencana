import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre GL v6 memecah worker ke berkas terpisah (maplibre-gl-worker.mjs) dan
// menurunkan URL-nya dari import.meta.url berkas bundler. Pada build Vite lokasi
// turunan itu tidak ada (404) sehingga worker gagal dibuat dan source GeoJSON
// tidak pernah selesai diproses - layer peta tetap kosong tanpa error konsol.
// Daftarkan URL worker hasil bundler Vite sebelum instance peta pertama dibuat.
setWorkerUrl(maplibreWorkerUrl)

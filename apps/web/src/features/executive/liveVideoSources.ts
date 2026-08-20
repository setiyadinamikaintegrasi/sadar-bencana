export type LiveVideoSource = {
  id: string
  name: string
  description: string
  category: string
  href: string
  sourceType: 'official' | 'media' | 'weather'
  availability: 'forecast' | 'continuous' | 'scheduled'
  contentType: 'weather-map' | 'video'
  embedUrl?: string
  /** URL yang dicek via YouTube oEmbed untuk menentukan kanal benar-benar
   *  bisa diputar (200) atau sedang tidak live (404). Tanpa field ini sumber
   *  dianggap selalu valid (mis. peta cuaca). */
  validateUrl?: string
}

export const liveVideoSources: LiveVideoSource[] = [
  {
    id: 'windy-indonesia',
    name: 'Windy Indonesia',
    description: 'Peta prakiraan interaktif untuk hujan, angin, suhu, awan, gelombang, dan parameter cuaca lainnya.',
    category: 'Prakiraan cuaca',
    href: 'https://www.windy.com/?-2.5,118,4',
    sourceType: 'weather',
    availability: 'forecast',
    contentType: 'weather-map',
    embedUrl:
      'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=default&metricTemp=default&metricWind=default&zoom=4&overlay=rain&product=ecmwf&level=surface&lat=-2.5&lon=118',
  },
  {
    id: 'merapi-badan-geologi',
    name: 'Merapi Activity',
    description: 'Pemantauan seismik dan visual (CCTV) Gunung Merapi dari Badan Geologi.',
    category: 'Gunung api',
    href: 'https://www.youtube.com/watch?v=vz1RLz9A5ZU',
    sourceType: 'official',
    availability: 'continuous',
    contentType: 'video',
    embedUrl: 'https://www.youtube-nocookie.com/embed/vz1RLz9A5ZU?rel=0&playsinline=1',
    validateUrl: 'https://www.youtube.com/watch?v=vz1RLz9A5ZU',
  },
  {
    id: 'info-bmkg',
    name: 'Info BMKG',
    description: 'Informasi cuaca, iklim, gempa bumi, dan geofisika dari kanal resmi BMKG.',
    category: 'Cuaca & gempa',
    href: 'https://www.youtube.com/infoBMKG/streams',
    sourceType: 'official',
    availability: 'scheduled',
    contentType: 'video',
    embedUrl:
      'https://www.youtube-nocookie.com/embed/live_stream?channel=UC8Do0tOnpnz1ydOZV0XKS3g&rel=0&playsinline=1',
    validateUrl: 'https://www.youtube.com/embed/live_stream?channel=UC8Do0tOnpnz1ydOZV0XKS3g',
  },
  {
    id: 'bnpb-indonesia',
    name: 'BNPB Indonesia',
    description: 'Konferensi pers, perkembangan penanganan, dan edukasi kebencanaan.',
    category: 'Penanggulangan bencana',
    href: 'https://www.youtube.com/@bnpb_indonesia/streams',
    sourceType: 'official',
    availability: 'scheduled',
    contentType: 'video',
    embedUrl:
      'https://www.youtube-nocookie.com/embed/live_stream?channel=UCcz9b2brFsk86Z_xruJMDoA&rel=0&playsinline=1',
    validateUrl: 'https://www.youtube.com/embed/live_stream?channel=UCcz9b2brFsk86Z_xruJMDoA',
  },
  {
    id: 'kompas-tv',
    name: 'KOMPAS TV',
    description: 'Breaking news nasional sebagai konteks sekunder ketika terjadi bencana.',
    category: 'Berita nasional',
    href: 'https://www.youtube.com/@kompastv/streams',
    sourceType: 'media',
    availability: 'scheduled',
    contentType: 'video',
    embedUrl:
      'https://www.youtube-nocookie.com/embed/live_stream?channel=UC5BMIWZe9isJXLZZWPWvBlg&rel=0&playsinline=1',
    validateUrl: 'https://www.youtube.com/embed/live_stream?channel=UC5BMIWZe9isJXLZZWPWvBlg',
  },
  {
    id: 'metro-tv',
    name: 'Metro TV',
    description: 'Siaran berita nasional dan breaking news sebagai sumber pelengkap.',
    category: 'Berita nasional',
    href: 'https://www.youtube.com/@METROTV/streams',
    sourceType: 'media',
    availability: 'scheduled',
    contentType: 'video',
    embedUrl:
      'https://www.youtube-nocookie.com/embed/live_stream?channel=UCkbPntO_8G2BF2HmLcrsZXA&rel=0&playsinline=1',
    validateUrl: 'https://www.youtube.com/embed/live_stream?channel=UCkbPntO_8G2BF2HmLcrsZXA',
  },
]

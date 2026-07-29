const technologyGroups = [
  {
    title: 'Antarmuka aplikasi',
    items: [
      {
        name: 'React, TypeScript, Vite, Tailwind CSS',
        detail: 'Dipakai untuk membangun dashboard web, navigasi, komponen tampilan, dan proses build frontend.',
      },
      {
        name: 'Lucide React',
        detail: 'Dipakai untuk ikon navigasi dan kontrol antarmuka.',
      },
    ],
  },
  {
    title: 'Peta, geospasial, dan geocoding',
    items: [
      {
        name: 'Leaflet dan React Leaflet',
        detail: 'Dipakai untuk peta interaktif, marker, polygon, watch zone, dan overlay peringatan.',
      },
      {
        name: 'OpenStreetMap',
        detail: 'Dipakai sebagai data peta dan geocoding berbasis Nominatim. Hak cipta data tetap milik kontributor OpenStreetMap.',
      },
      {
        name: 'CARTO basemap tiles',
        detail: 'Dipakai pada beberapa tampilan peta gelap. Data dasar tetap mengikuti atribusi OpenStreetMap dan CARTO.',
      },
      {
        name: 'PostGIS',
        detail: 'Dipakai untuk penyimpanan dan pemrosesan data geometri pada PostgreSQL.',
      },
    ],
  },
  {
    title: 'AI dan orkestrasi',
    items: [
      {
        name: 'Mastra',
        detail: 'Dipakai sebagai layanan AI workflow dan agent untuk briefing serta copilot analisis.',
      },
      {
        name: 'AI SDK dan penyedia model kompatibel OpenAI',
        detail: 'Dipakai sebagai lapisan integrasi model AI. Kunci API, model, dan batas pemakaian dikendalikan melalui konfigurasi deployment.',
      },
    ],
  },
  {
    title: 'Backend, worker, dan runtime',
    items: [
      {
        name: 'Go, Gin, pgx',
        detail: 'Dipakai untuk API utama, autentikasi, query PostgreSQL, dan endpoint aplikasi.',
      },
      {
        name: 'Python, FastAPI, Uvicorn, asyncpg, httpx, Pydantic',
        detail: 'Dipakai untuk worker ingestion, konektor data, normalisasi event, dan validasi payload.',
      },
      {
        name: 'Redis dan Docker Compose',
        detail: 'Dipakai untuk runtime service lokal/produksi, queue ringan, dan isolasi layanan.',
      },
      {
        name: 'Supabase PostgreSQL',
        detail: 'Dipakai untuk database aplikasi, autentikasi, dan penyimpanan data operasional.',
      },
    ],
  },
  {
    title: 'Sumber data dan layanan eksternal',
    items: [
      {
        name: 'BMKG',
        detail: 'Dipakai sebagai sumber resmi untuk gempa, peringatan cuaca, dan kualitas udara jika konektor terkait diaktifkan.',
      },
      {
        name: 'GDACS, PetaBencana.id, Smithsonian GVP, OpenSky, RSS berita',
        detail: 'Dipakai sebagai sumber pemantauan tambahan sesuai konfigurasi konektor dan ketersediaan layanan masing-masing.',
      },
      {
        name: 'Cloudflare dan Let\'s Encrypt',
        detail: 'Dipakai pada lapisan hosting/domain untuk DNS, TLS, proteksi edge, atau sertifikat sesuai konfigurasi produksi.',
      },
    ],
  },
]

const complianceNotes = [
  'Kode aplikasi Sadar Bencana dilisensikan terpisah dari dependency pihak ketiga. Lihat LICENSE dan NOTICE pada repository.',
  'Nama, merek dagang, logo, peta, tile, API, model AI, dan dataset pihak ketiga tetap menjadi milik pemiliknya masing-masing.',
  'Aplikasi ini bukan kanal resmi pemerintah, kecuali data yang ditampilkan memang berasal dari sumber resmi dan diberi label sumber.',
  'Pemakaian API, tile map, geocoder, dan model AI harus tetap mengikuti syarat layanan, batas pemakaian, dan kebijakan atribusi pemilik layanan.',
]

function TechnologyAttributionPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Open source disclosure</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-50">Teknologi & Lisensi</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Halaman ini mencatat teknologi, library, layanan, dan sumber data utama yang digunakan Sadar Bencana.
          Tujuannya adalah memberi atribusi yang jelas kepada pemilik teknologi dan membantu pemeriksaan kepatuhan
          lisensi sebelum deployment produksi.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {technologyGroups.map((group) => (
          <article key={group.title} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-semibold text-slate-50">{group.title}</h2>
            <div className="mt-4 space-y-3">
              {group.items.map((item) => (
                <div key={item.name} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <h3 className="text-sm font-semibold text-slate-100">{item.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <article className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
        <h2 className="text-lg font-semibold text-amber-100">Catatan kepatuhan</h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-amber-50/85">
          {complianceNotes.map((note) => (
            <li key={note} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </article>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm leading-6 text-slate-300">
        <h2 className="text-lg font-semibold text-slate-50">Referensi publik</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a className="text-cyan-300 hover:text-cyan-200" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap copyright</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://leafletjs.com/" target="_blank" rel="noreferrer">Leaflet</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://react-leaflet.js.org/" target="_blank" rel="noreferrer">React Leaflet</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://mastra.ai/" target="_blank" rel="noreferrer">Mastra</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://supabase.com/" target="_blank" rel="noreferrer">Supabase</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://www.bmkg.go.id/" target="_blank" rel="noreferrer">BMKG</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://www.gdacs.org/" target="_blank" rel="noreferrer">GDACS</a>
          <a className="text-cyan-300 hover:text-cyan-200" href="https://petabencana.id/" target="_blank" rel="noreferrer">PetaBencana.id</a>
        </div>
      </div>
    </section>
  )
}

export default TechnologyAttributionPage

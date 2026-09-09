## Catatan Investigasi — BMKG CAP vs Regional Mismatch

### URL yang diuji (dev, 1 Sep 2026)

| # | URL | HTTP | Timestamp item terbaru | Catatan |
|---|-----|------|----------------------|--------|
| 1 | `https://www.bmkg.go.id/alerts/nowcast/id` (RSS utama) | 200 | item 24 Agu 2026 (08:30 +0700) | STALE >48 jam; hanya 3 item |
| 2 | `https://www.bmkg.go.id/alerts/nowcast/en/rss.xml` (RSS EN) | 200 | item 24 Agu 2026 | STALE sama; channel pubDate 1 Sep |
| 3 | `https://www.bmkg.go.id/alerts/nowcast/id/CSU20260901002_alert.xml` (CAP detail dari regional) | **404** | — | CAP detail TIDAK tersedia utk alert regional baru |
| 4 | `https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca/12` (halaman regional Sumut) | 200 | konten **1 Sep 2026 12:50 WIB** FRESH | alert ID: CSU20260901002; gambar nowcasting.bmkg.go.id/CSU/2026/09/01/ |
| 5 | `https://www.bmkg.go.id/cuaca/potensi-cuaca-ekstrem` | 200 | 7–11 Sep 2026 | prakiraan mingguan (BUKAN nowcast; beda produk) |
| 6 | `https://data.bmkg.go.id/peringatan-dini-cuaca/` (dokumentasi open data) | 200 | — | resmi: hanya endpoint RSS/CAP di atas; rate limit 60/mnt; wajib atribusi |

### Temuan kunci

1. **RSS CAP publik stale** — item terbaru 24 Agu (>48 jam) meski channel pubDate 1 Sep. Worker sudah benar menandai `feed_stale` (PR #195).
2. **Halaman regional (12) FRESH** — konten 1 Sep berisi alert ID `CSU20260901002`, tapi:
   - **CAP detail XML utk ID tsb 404** — BMKG menerbitkan ke halaman regional TANPA menaruhnya di RSS/CAP publik.
   - Halaman regional = HTML render (Next.js app), bukan endpoint data/XML.
3. **Dokumentasi open data resmi** hanya mempublikasikan endpoint RSS + CAP detail yang kita sudah pakai — tidak ada endpoint XML regional resmi.
4. Halaman `potensi-cuaca-ekstrem` = produk prakiraan mingguan berbeda (bukan pengganti nowcast; aturan #2 analog: jangan dicampur).

### Root cause mismatch

BMKG (sebagian wilayah) menerbitkan peringatan dini ke **halaman regional web** lebih dulu/cuma, tanpa sinkron ke **feed CAP publik**. Feed CAP tetap sumber resmi utama (aturan #3), tapi saat stale, data regional lebih baru — perlu fallback berlabel `bmkg_regional` dengan parsing HTML halaman regional (aturan #8: tidak ada endpoint XML regional resmi — scraping HTML adalah satu-satunya jalur; harus dgn fixture + validasi freshness ketat).

### effective/expires di regional page

Halaman regional menampilkan teks bebas (mis. "berpotensi... hari ini") + gambar infografis — TIDAK ada field effective/expires terstruktur. Fallback harus menurunkan masa berlaku dari tanggal terbit + label "masa berlaku tidak terstruktur (perkiraan)" — atau menolak bila tak bisa dipastikan (aturan #9).

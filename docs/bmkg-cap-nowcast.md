# BMKG CAP Nowcast Connector

Connector ini mengambil daftar peringatan dini cuaca aktif dari RSS BMKG,
membaca dokumen Common Alerting Protocol (CAP), dan menyimpannya sebagai alert
resmi yang memiliki revision history serta source provenance.

## Prasyarat

Terapkan migration secara berurutan, termasuk:

```bash
psql "$DATABASE_URL" -f db/schema/019_official_alert_lifecycle.sql
psql "$DATABASE_URL" -f db/schema/021_source_evidence_model.sql
```

Aktifkan connector setelah migration selesai:

```env
CONNECTOR_BMKG_CAP_ENABLED=true
```

Nilai default adalah `false`. Connector dijalankan bersama ingest scheduler
setiap lima menit.

## Sumber dan attribution

- Daftar alert: `https://www.bmkg.go.id/alerts/nowcast/id`
- Detail: URL CAP HTTPS pada domain `bmkg.go.id` yang tercantum di feed
- Attribution: `BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)`

Maksimal 50 dokumen CAP diproses per siklus sehingga total request tetap di
bawah 60 request per menit. Redirect diikuti, tetapi URL detail awal harus
menggunakan HTTPS dan berada pada domain BMKG.

## Aturan normalisasi

- blok `info` berbahasa Indonesia diprioritaskan;
- koordinat CAP `latitude,longitude` dikonversi menjadi GeoJSON
  `longitude,latitude`;
- `effective` dan `expires` disimpan tanpa inferensi;
- `Update` dan `Cancel` dihubungkan ke identifier alert awal melalui
  `references`;
- payload XML, URL sumber, identifier pesan, timestamp, dan attribution
  disimpan sebagai provenance;
- kegagalan satu detail CAP tidak membatalkan detail lain dalam siklus yang
  sama dan tetap terlihat pada connector health.

SadarBencana tidak memperpanjang masa berlaku, mengubah tingkat peringatan, atau
membuat pembatalan sendiri. Teks BMKG disimpan sesuai sumber dan harus
ditampilkan sebagai informasi resmi BMKG.

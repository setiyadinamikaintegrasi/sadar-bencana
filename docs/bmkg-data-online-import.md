# BMKG Data Online XLSX Import

Admin dapat mem-preview workbook historis yang diunduh manual dari BMKG Data
Online. Preview berjalan di memori, dibatasi 10 MB/50.000 baris, dan tidak
menyimpan payload.

Format terverifikasi:

- metadata laporan berada sebelum header;
- header aktual: `DATE (GMT)`, `LINTANG (°)`, `BUJUR (°)`,
  `KEDALAMAN (KM)`, dan `MAGNITUDO (M)`;
- waktu dinormalisasi sebagai UTC;
- `source_record_id` deterministik dibentuk dari waktu, koordinat, kedalaman,
  dan magnitudo.

Endpoint internal worker:

```http
POST /api/v1/worker/imports/bmkg-data-online/preview
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

Endpoint admin melalui API:

```http
POST /api/v1/settings/historical/bmkg-data-online/preview
Authorization: Bearer <supabase-jwt>
```

Impor final tetap dinonaktifkan bila titik belum dapat dipetakan ke
`administrative_boundaries`. Migration `033_bmkg_data_online_import.sql`
menyediakan bbox, batch audit, dan staging unresolved agar data tidak dipaksa
masuk menggunakan kode wilayah rekaan.

Boundary harus berasal dari dataset resmi yang disertai source, version, field
mapping, geometri Polygon/MultiPolygon, dan checksum. Portal rujukan:

- BIG Ina-Geoportal: https://tanahair.indonesia.go.id/
- kode wilayah Kemendagri;
- bridging kode BPS: https://sig.bps.go.id/bridging-kode/index


# Regional Historical Profile API

`GET /api/v1/historical/regions/{administrative_code}/profile` menghitung
timeline tahunan, seasonality bulanan, latest impact revision, source coverage,
dan data freshness langsung dari historical warehouse.

Parameter opsional: `from`, `to` (`YYYY-MM-DD`) dan `peril`. Rentang dibatasi
maksimal 50 tahun. Wilayah wajib menggunakan kode administrasi; nama bebas
tidak dipakai untuk menghindari kabupaten/kota bernama mirip.

Respons selalu memuat period, method, limitations, source coverage, dan
freshness. Missing impact tidak direka dan dijelaskan sebagai keterbatasan.

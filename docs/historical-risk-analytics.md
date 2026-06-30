# Historical Risk Analytics

`historical-analytics-v1` menghitung tren tahunan, seasonality, komposisi peril,
impact totals, normalized impact rate, dan anomaly flag di backend.

Rate hanya dihitung bila denominator tersedia dan selalu menyertakan nilai
denominator. Data kosong menghasilkan confidence rendah serta missing-data
flags, bukan angka buatan. Anomaly memakai aturan deterministik
`mean + 2 × population standard deviation` dengan minimal tiga periode.

Snapshot terstruktur ini menjadi satu-satunya input numerik yang diizinkan
untuk dashboard dan AI regional analyst.

# Historical Disaster Warehouse

Migration `028_historical_disaster_warehouse.sql` memisahkan warehouse historis
dari tabel event real-time.

Setiap event menunjuk dataset source/version/checksum dan administrative code.
Boundary menyimpan masa berlaku sehingga perubahan wilayah tidak mencampur
statistik lintas versi. Impact correction ditambahkan sebagai immutable
revision dengan `correction_of`, bukan menimpa nilai lama.

`historical_backfill_jobs.checkpoint` menyimpan cursor/page terakhir dan jumlah
record yang diproses. Backfill dapat dilanjutkan setelah gagal dan insert
idempotent berdasarkan dataset, source record ID, serta payload checksum.

Dataset hanya boleh berasal dari endpoint/file yang izin dan attribution-nya
terdokumentasi. Raw manifest dan raw event payload dipertahankan untuk audit.

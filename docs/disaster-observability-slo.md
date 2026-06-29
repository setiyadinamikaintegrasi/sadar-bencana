# Disaster Observability and SLO

Endpoint `GET /api/v1/metrics/disaster` menampilkan window 24 jam, keberhasilan
pemrosesan payload, persentase notification di bawah 60 detik, failure count,
dan volume alert per source/peril/severity.

SLO awal:

- 99% payload valid diproses tanpa error;
- 95% notifikasi terkirim kurang dari 60 detik;
- tidak ada silent connector failure;
- source health diperbarui maksimal dua interval polling.

`disaster_observability_events` menyimpan stage, success, duration, error code,
dan metadata terbatas. Correlation ID deterministik dari source + native record
ID menghubungkan lifecycle source sampai delivery tanpa menyimpan PII.

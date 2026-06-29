# Disaster Operations Runbook

## Safety boundary

SadarBencana adalah sistem monitoring dan decision support. Label **official**
hanya berlaku untuk pesan yang berasal dari otoritas dan wording sumber tidak
boleh diubah. Event observed, kajian risiko statis, sinyal inferred, dan laporan
unverified harus tetap dibedakan. Sistem tidak memprediksi waktu/lokasi gempa
dan tidak membuat instruksi evakuasi sendiri.

## Triage awal

1. Periksa `GET /api/v1/health/connectors`.
2. Periksa `GET /api/v1/metrics/disaster` untuk SLO dan failure 24 jam.
3. Telusuri correlation ID pada `disaster_observability_events`.
4. Periksa `.logs/worker.log` dan `.logs/api.log`.
5. Catat waktu mulai, source, peril, revision, serta dampak pengguna.

## Source outage

1. Pastikan outage bukan masalah DNS, credential, migration, atau rate limit.
2. Jangan menurunkan status warning terakhir secara otomatis; tandai stale.
3. Nonaktifkan connector terkait melalui feature flag dan restart worker.
4. Pantau sumber resmi secara manual sampai connector pulih.
5. Aktifkan kembali dalam canary dan pastikan source-health kembali normal.

Feature flags:

```env
CONNECTOR_BMKG_CAP_ENABLED=false
EVIDENCE_CORRELATION_ENABLED=false
EWS_LIFECYCLE_DELIVERY_ENABLED=false
```

## False alert atau korelasi salah

1. Hentikan delivery terkait bila bukti tidak cukup.
2. Jangan menghapus raw source, correlation decision, atau delivery log.
3. Gunakan audited split operation untuk membatalkan merge event.
4. Catat actor, reason, source revision, dan pengguna yang sudah menerima.
5. Kirim correction menggunakan lifecycle revision baru; jangan mengubah
   notification lama secara diam-diam.

## Correction, cancellation, dan expiry

- Update/correction harus memakai revision baru.
- Cancellation dikirim kepada seluruh penerima alert awal.
- Expiry berasal dari timestamp resmi; jangan memperpanjang secara inferensi.
- Pantau dead-letter dan retry. Setelah perbaikan, replay delivery dengan dedup
  key revision yang sama agar tidak mengirim duplikat.
- Verifikasi acknowledgement per subscriber bila insiden berdampak tinggi.

## Attribution dan sumber

| Sumber | Penggunaan | Kanal resmi |
|---|---|---|
| BMKG | gempa, cuaca, warning CAP | https://www.bmkg.go.id |
| BNPB | laporan situasi dan dampak | https://www.bnpb.go.id |
| PVMBG/MAGMA | aktivitas gunung api | https://magma.esdm.go.id |
| InaRISK | kajian hazard/exposure | https://inarisk.bnpb.go.id |
| USGS | evidence gempa independen | https://earthquake.usgs.gov |

Gunakan halaman kontak resmi masing-masing lembaga. Jangan menyimpan kontak
pribadi petugas di repository.

## Migration incident

Migration bersifat forward-only. Sebelum migration 025–027, ambil backup
database development/staging dan jalankan smoke test. Jika deployment gagal,
nonaktifkan feature flag terkait dan lakukan forward-fix migration; jangan
menjatuhkan tabel audit atau raw evidence. Rollback aplikasi hanya aman bila
kode lama mengabaikan kolom tambahan.

## Incident review

Review maksimal satu hari kerja setelah stabil:

- timeline detection, alert, delivery, acknowledgement, correction;
- source coverage, stale period, precision/recall per peril;
- notification latency p50/p95 dan dead-letter;
- keputusan manual beserta actor/reason;
- root cause, contributing factors, dan action owner;
- fixture replay baru agar insiden menjadi regression test.

## Release checklist

```bash
cd apps/worker && .venv/bin/pytest -q
cd ../api && go test ./...
cd ../.. && npm run build --workspace apps/web
npm run verify
```

Pastikan migration 022–027 telah diterapkan berurutan di staging, replay gates
lulus, SLO tidak regresi, dan wording keselamatan telah direview domain expert.

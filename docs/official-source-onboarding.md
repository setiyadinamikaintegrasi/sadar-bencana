# Official Source Onboarding

Sumber yang belum mendapat izin tetap `disabled`. Konfigurasi baru mengikuti
alur berikut:

1. administrator memasukkan endpoint, token, adapter version, dan field mapping;
2. **Preview** mengambil maksimum 1 MB dan menampilkan maksimal tiga sample;
3. preview meredaksi field token/password/secret dan tidak menyimpan payload;
4. konfigurasi disimpan sebagai versi baru dalam mode `dry_run`;
5. **Jalankan dry-run** memvalidasi record tanpa membuat source record, alert,
   impact report, atau risk context;
6. **Aktifkan** hanya tersedia bila dry-run sukses pada config version yang sama;
7. rollback mengembalikan snapshot lama sebagai versi baru dan wajib memiliki
   alasan.

Field mapping adalah object JSON dengan canonical field sebagai key dan dot path
payload sebagai value. Key khusus `__records` menunjuk lokasi array record.

```json
{
  "__records": "response.records",
  "report_id": "identifier",
  "observed_at": "times.observed"
}
```

Adapter registry saat ini menyediakan `v1` untuk InaTEWS, PVMBG, BNPB, dan
InaRISK. Fixture `provisional-v1.json` bersifat sintetis karena contoh payload
resmi belum tersedia. Setelah izin diterima, simpan sample resmi yang sudah
disanitasi sebagai fixture baru, tambahkan adapter version bila kontraknya
berbeda, lalu jalankan contract tests sebelum dry-run.

Audit menyimpan action, config version, hasil, waktu, dan email administrator.
Token tetap terenkripsi dan tidak pernah masuk response preview, version JSON,
atau metadata audit.

Migration:

```bash
psql "$DATABASE_URL" -f db/schema/032_official_source_onboarding.sql
```

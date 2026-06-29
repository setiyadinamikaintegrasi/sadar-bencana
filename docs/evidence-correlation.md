# Evidence Correlation

Phase 2 mengorelasikan laporan lintas sumber tanpa menghapus event atau raw
evidence. Engine berjalan deterministik dan default-nya **shadow mode**:
keputusan disimpan untuk observasi/review, tetapi tidak melakukan merge
otomatis.

## Migration dan aktivasi

```bash
psql "$DATABASE_URL" -f db/schema/022_evidence_correlation.sql
```

Setelah migration:

```env
EVIDENCE_CORRELATION_ENABLED=true
```

## Aturan korelasi v1

Kandidat wajib memiliki peril yang sama. Score menggabungkan jarak, selisih
waktu, shared source identifier, dan independence group.

| Peril | Jarak kandidat | Jendela waktu |
|---|---:|---:|
| earthquake | 100 km | 15 menit |
| flood | 30 km | 24 jam |
| volcano | 10 km | 7 hari |
| wildfire | 10 km | 12 jam |

Keputusan:

- `merge`: confidence minimal 0,78;
- `review`: confidence 0,50–0,779;
- `distinct`: di bawah 0,50 atau peril berbeda.

Nilai dan alasan disimpan bersama `rule_version=correlation-v1`, sehingga hasil
dapat direproduksi. Keputusan `distinct` tidak disimpan oleh shadow pipeline
untuk membatasi pertumbuhan tabel.

## Independensi sumber

`source_independence_rules` memetakan connector ke organisasi/sensor asal.
Contohnya `bmkg`, `bmkg_cap`, dan `inatews` berada dalam group `bmkg`, sehingga
tidak dihitung sebagai tiga konfirmasi independen.

`source_records.origin_source_name` wajib diisi ketika media/citizen report
mengutip sumber lain. Confidence aggregation hanya memakai evidence terkuat
dari setiap independence group. Dengan demikian dua artikel yang sama-sama
mengutip BMKG tetap dihitung sebagai satu sumber.

## Review dan audit

```http
GET /api/v1/correlations/review-queue
GET /api/v1/correlations/review-queue?status=approved
GET /api/v1/events/{event_uuid}/correlation-audit
```

Merge bersifat logical: kedua event dan seluruh evidence tetap disimpan.
`merge_events` membuat membership aktif serta immutable `merge` operation.
`split_event_merge` membatalkan membership melalui immutable `split` operation
yang menunjuk operasi merge sebelumnya. Tidak ada hard delete dalam lifecycle
korelasi.

Mutation review/merge belum diekspos sebagai endpoint publik. Operasi tersebut
harus dijalankan melalui service terautentikasi pada fase policy/admin agar
actor dan reason tidak dapat dipalsukan.

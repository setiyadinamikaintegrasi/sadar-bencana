# Daftar Risiko — konfigurasi deployment

Satu basis kode, perilaku diatur env. Tak ada versi/fork terpisah.

## Mode deployment

Gunakan `DEPLOYMENT_MODE=community` untuk instalasi GitHub. Mode ini tidak
membutuhkan token organisasi dan tidak membatasi aset personal.

Deployment resmi `sadarbencana.id` menggunakan:

```env
DEPLOYMENT_MODE=hosted
PERSONAL_ASSET_LIMIT=20
ENTITLEMENT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

Pada mode hosted, aset personal tersedia bagi semua akun hingga batas yang
ditetapkan, sedangkan portofolio perusahaan membutuhkan entitlement organisasi.

Sebelum menjalankan versi ini, backup database lalu terapkan migrasi:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/schema/034_personal_assets_and_entitlements.sql
```

## Mengelola token organisasi

Private key hanya disimpan pada komputer penerbit, bukan di repository atau
server aplikasi:

```bash
cd apps/api
go run ./cmd/sadar-license init
go run ./cmd/sadar-license issue \
  --organization "PT Contoh Asuransi" \
  --max-users 10 \
  --max-risks 1000 \
  --days 365
go run ./cmd/sadar-license list
go run ./cmd/sadar-license inspect "<token>"
```

Salin isi public key ke `ENTITLEMENT_PUBLIC_KEY` pada deployment hosted. Token
yang dihasilkan diberikan kepada owner organisasi untuk diaktifkan pada halaman
Daftar Risiko.

## RISK_FREE_LIMIT
- **Community:** tidak diset (atau `0`) sehingga portofolio tidak dibatasi.
- **Hosted:** batas portofolio perusahaan berasal dari claim `max_company_risks`
  pada token. `RISK_FREE_LIMIT` hanya menjadi fallback kompatibilitas.

Set di environment proses API (mis. `.env.local` repo root yang di-source `start.sh`):
```
RISK_FREE_LIMIT=0
```

## Privasi
Semua endpoint wajib login dengan JWT Supabase. Aset personal di-scope ke
`auth_user_id`; portofolio community di-scope ke user dan portofolio hosted
di-scope ke organisasi aktif. Template CSV tetap publik dan tidak berisi data
pengguna.

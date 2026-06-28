# Daftar Risiko — konfigurasi deployment

Satu basis kode, perilaku diatur env. Tak ada versi/fork terpisah.

## RISK_FREE_LIMIT
- **Self-host (open-source):** tidak diset (atau `0`) → jumlah risiko **tanpa batas**.
- **Hosting sadarbencana.id:** `RISK_FREE_LIMIT=5` di environment API → user dibatasi 5 risiko; menambah ke-6 ditolak (403) dengan arahan self-host.

Set di environment proses API (mis. `.env.local` repo root yang di-source `start.sh`):
```
RISK_FREE_LIMIT=5
```
Nilai juga diumumkan di `GET /api/v1/meta` (`risk_free_limit`) agar UI menampilkan "N / 5".

## Privasi
Semua endpoint risiko (`/api/v1/contracts*`, `/api/v1/accumulation`) wajib login (JWT Supabase) dan di-scope ke `auth_user_id` pemilik. Tak ada user yang bisa melihat risiko user lain. Template CSV (`/api/v1/contracts/import/template`) tetap publik (statis).

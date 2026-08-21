# Panduan Konfigurasi Email Konfirmasi (SMTP)

Dokumen ini menuntut konfigurasi SMTP agar **konfirmasi email pendaftaran**
berfungsi nyata (sejak compose auth default `GOTRUE_MAILER_AUTOCONFIRM=false`).

## Status

| Lingkungan | Autoconfirm | SMTP | Efek |
|---|---|---|---|
| Production (default baru) | **false** | **belum diisi** | Pendaftaran menghasilkan akun *belum terkonfirmasi* — **wajib konfigurasi SMTP** (lihat langkah) atau akun baru tidak bisa login |
| Development (`infra/local`) | true | — | Akun langsung aktif (praktis untuk dev) |

## Langkah Konfigurasi Production

1. Siapkan akun SMTP pengirim. Contoh layanan (pilih satu):
   - **Resend** (rekomendasi, mudah): buat domain `sadarbencana.id` → Domain Settings → dapatkan API key.
   - **Brevo / SendGrid / SMTP sendiri**: apa pun yang memberi host/port/user/pass.

2. Tambahkan di file `.env` GoTrue di server (di mana `docker-compose.auth.yml` dijalankan):

   ```env
   # Resend (contoh)
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=587
   SMTP_USER=resend
   SMTP_PASSWORD=re_xxxxxxxxxxxxxxxx
   SMTP_FROM=SadarBencana <noreply@sadarbencana.id>

   # Opsional: matikan sementara konfirmasi bila SMTP belum siap
   # GOTRUE_MAILER_AUTOCONFIRM=true
   ```

3. Recreate container auth:

   ```bash
   docker compose -f docker-compose.auth.yml up -d --force-recreate gotrue
   ```

4. Verifikasi:

   ```bash
   # cek settings publik: mailer_autoconfirm harus false
   curl -s https://auth.sadarbencana.id/settings | jq .mailer_autoconfirm
   # daftar akun percobaan -> cek email masuk -> klik tautan -> login berhasil
   ```

## Perilaku UI

- `LoginGate` kini **jujur otomatis**: pesan sukses pendaftaran menyesuaikan
  respons GoTrue — bila sesi tidak terisi (konfirmasi diperlukan) ia menampilkan
  "Cek email Anda untuk tautan konfirmasi" + tombol kirim ulang; bila akun
  langsung aktif (autoconfirm) ia menampilkan "akun langsung aktif, silakan masuk".
- Halaman **Admin Pengguna** menampilkan badge **Terkonfirmasi / Belum** per
  pengguna, dan tombol **Tautan** dapat membuat magiclink manual (berguna saat
  email pengguna bermasalah).

## Catatan Keamanan

- `GOTRUE_MAILER_URLPATHS_CONFIRMATION: /verify` sudah dikonfigurasi — tautan
  akan mengarah ke `https://sadarbencana.id/verify?token=…` (frontend menangani
  verifikasi via supabase-js).
- Jangan menaruh SMTP_PASSWORD di repo — hanya di `.env` server.
- Rate limit resend bawaan GoTrue aktif (mencegah spam email).

## Template Email Ber-Brand

Template HTML ber-brand tersedia di `infra/production/templates/email/`:
`confirmation.html`, `invite.html`, `recovery.html`, `magiclink.html`.

Aktifkan dengan mengisi env berikut (file lokal via mount, atau URL https):

```env
# Opsi A: file lokal (compose sudah mount ./templates/email -> /templates/email)
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=/templates/email/confirmation.html
GOTRUE_MAILER_TEMPLATES_INVITE=/templates/email/invite.html
GOTRUE_MAILER_TEMPLATES_RECOVERY=/templates/email/recovery.html
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=/templates/email/magiclink.html

# Opsi B: URL publik (mis. host di web)
# GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://sadarbencana.id/email-templates/confirmation.html
```

Lalu `docker compose -f docker-compose.auth.yml up -d --force-recreate gotrue`.

Variabel GoTrue yang tersedia dalam template: `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .Token }}`, `{{ .SiteURL }}`.

Subject email sudah di-set di compose: "Konfirmasi pendaftaran akun SadarBencana Anda", dll.

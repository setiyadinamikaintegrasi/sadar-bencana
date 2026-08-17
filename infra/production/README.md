# Production Database & Auth Stack (Self-Hosted)

Stack produksi untuk menggantikan Supabase yang suspended: PostgreSQL + PostGIS
dan GoTrue (Supabase Auth) self-hosted, berjalan di VPS yang sama dengan aplikasi.

## Components

| Service | Container | Port | Purpose |
|---|---|---|---|
| PostgreSQL 17 + PostGIS | `sadar-postgres` | 5432 (127.0.0.1) | Primary database (events, alerts, EWS, ...) |
| GoTrue | `sadar-gotrue` | 9999 (127.0.0.1) | Supabase-compatible auth (login, signup, JWT) |

Kedua service berbagi Docker network eksternal `sadar-net` sehingga container
aplikasi (api/worker) bisa mengakses database lewat nama host `sadar-postgres`.

## Requirements

- Docker + Docker Compose v2
- Variabel env (jangan di-commit): `POSTGRES_PASSWORD`, `GOTRUE_DB_URL`,
  `GOTRUE_JWT_SECRET`, `GOTRUE_SITE_URL`, SMTP vars (opsional)

## Usage

```bash
# 1. Buat network eksternal (sekali saja)
docker network create sadar-net

# 2. Setup variabel env
export POSTGRES_PASSWORD="<strong-password>"
export GOTRUE_DB_URL="postgres://supabase_auth_admin:<pass>@sadar-postgres:5432/postgres"
export GOTRUE_JWT_SECRET="<same-secret-as-before>"

# 3. Start database
docker compose -f docker-compose.db.yml up -d

# 4. Start auth (GoTrue)
docker compose -f docker-compose.auth.yml up -d
```

## Restore Backup (Supabase cluster dump)

```bash
# Backup file: db_cluster-*.backup.gz (pg_dumpall format)
cd /root/backups
zcat db_cluster-*.backup.gz \
  | sed 's/ALTER ROLE postgres WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS/ALTER ROLE postgres WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS/' \
  | docker exec -i sadar-postgres psql -U sadar -d postgres -v ON_ERROR_STOP=0
```

Catatan penting setelah restore:
- Hapus `session_preload_libraries` dari role `authenticator`
  (`supautils`/`safeupdate` tidak tersedia di image Postgres standar)
- Beri grant akses schema `auth` & `public` ke role GoTrue
- Set password role `supabase_auth_admin` (dipakai GoTrue)

## Caddy Reverse Proxy

Subdomain `auth.sadarbencana.id` diarahkan ke GoTrue (port 9999) dengan:

- Strip prefix `/auth/v1/*` (supabase-js memakai path ini)
- CORS header untuk origin `https://sadarbencana.id`
- Hapus header CORS dari GoTrue (mengirim `*`) agar tidak duplikat
- Sertifikat Let's Encrypt diterbitkan otomatis oleh Caddy

## Backup Rutin

Jadwalkan `pg_dump` harian (lihat `scripts/backup-db.sh` di repo) ke
`/root/backups/` dengan rotasi 7 hari.

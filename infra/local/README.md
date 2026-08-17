# Local Dev Stack (paritas production)

Infrastruktur dev sekarang mencerminkan `infra/production` (pasca-migrasi dari
Supabase): PostgreSQL 17 + PostGIS self-hosted dan auth lokal via API Go.

## Target local ports
- postgres: **5432** (`127.0.0.1:5432`, container `sadar-postgres`) — sama dengan production
- gotrue (opsional): 9999 (`127.0.0.1:9999`, container `sadar-gotrue`)
- redis: 6379 (native redis-server di host, versi sama dengan production)
- api: 8001, worker: 8002, web: 3001 (host-native via `./start.sh`)

## Usage

```bash
# Start/stop DB (PostgreSQL 17 + PostGIS 3.5, network sadar-net)
docker compose -f infra/local/docker-compose.yml up -d
docker compose -f infra/local/docker-compose.yml down      # data tetap ada (volume)
docker compose -f infra/local/docker-compose.yml down -v   # HAPUS data dev!

# First init: apply semua migrasi db/schema/*.sql
bash infra/local/init-db.sh

# Opsional — GoTrue (paritas penuh production; flow auth utama via API
# /auth/register|login|me TIDAK butuh service ini)
docker compose -f infra/local/docker-compose.yml --profile auth up -d
```

## Paritas dengan production

| Aspek | Production (`infra/production`) | Dev (`infra/local`) |
|---|---|---|
| Image DB | `postgis/postgis:17-3.5` | `postgis/postgis:17-3.5` |
| Container | `sadar-postgres` | `sadar-postgres` |
| Network | `sadar-net` | `sadar-net` |
| User/DB | `sadar` / `sadar_bencana` | `sadar` / `sadar_bencana` |
| Hostname dari kontainer app | `sadar-postgres:5432` | `sadar-postgres:5432` |
| Auth | GoTrue + local auth API (`local_users`) | local auth API (`local_users`); GoTrue opsional |

## Environment (host-native apps)

`DATABASE_URL` mengarah ke DB lokal (bukan Supabase):

```
DATABASE_URL=postgresql://sadar:sadar_dev_password@127.0.0.1:5432/sadar_bencana
```

Token auth lokal ditandatangani dengan `SUPABASE_JWT_SECRET` (peran yang sama
dengan `GOTRUE_JWT_SECRET` di production). Frontend tidak lagi memakai
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — auth lewat API `/auth/*`.

## Migrasi dari stack lama (sadar_dev @ postgis:16)

Data lama sudah dimigrasikan via `pg_dump | pg_restore`. Untuk mengulang:

```bash
docker exec sadar-dev-pg pg_dump -U postgres -Fc sadar_dev > /tmp/sadar_dev.dump
docker exec -i sadar-postgres pg_restore -U sadar -d sadar_bencana \
  --no-owner --no-privileges < /tmp/sadar_dev.dump
```

Container lama `sadar-dev-pg` (port 55432) boleh dihapus setelah migrasi diverifikasi.

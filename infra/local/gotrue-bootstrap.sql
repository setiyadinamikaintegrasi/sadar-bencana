-- =============================================================================
-- gotrue-bootstrap.sql — bootstrap GoTrue (Supabase Auth) self-hosted untuk dev
-- Dipakai oleh infra/local/docker-compose.yml (profile `auth`).
-- Meniru peran/schema yang di production berasal dari restore dump Supabase.
-- Cara pakai (sekali saja setelah postgres healthy):
--   docker compose -f infra/local/docker-compose.yml up -d postgres
--   docker exec -i sadar-postgres psql -U sadar -d sadar_bencana < infra/local/gotrue-bootstrap.sql
--   docker compose -f infra/local/docker-compose.yml --profile auth up -d gotrue
-- Idempotent: aman dijalankan ulang.
-- =============================================================================

-- Role standar Supabase (di production ada dari dump).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres SUPERUSER LOGIN;
    END IF;
END
$$;

-- Role koneksi GoTrue + hak akses.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'sadar_dev_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

GRANT CREATE ON DATABASE sadar_bencana TO supabase_auth_admin;
GRANT ALL ON SCHEMA public TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Schema auth (tabel/function dibuat otomatis oleh migrasi GoTrue).
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;

-- GoTrue menjalankan `create type factor_type` TANPA prefix schema; pastikan
-- type tersebut dibuat di schema auth (bukan public) dengan search_path role.
ALTER ROLE supabase_auth_admin SET search_path TO auth, public;

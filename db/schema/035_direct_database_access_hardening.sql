BEGIN;

-- SadarBencana serves application data through the Go API. The browser uses
-- Supabase directly only for authentication, so anon/authenticated must not
-- receive a second data path that bypasses API authorization, entitlement
-- limits, auditing, and validation.

DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
            target.schemaname,
            target.tablename
        );
    END LOOP;
END
$$;

-- RLS with no permissive policy is deny-by-default. Revoke the underlying
-- privileges as a second independent control, including privileges such as
-- TRUNCATE, REFERENCES, and TRIGGER that are not filtered by row policies.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
    FROM PUBLIC, anon, authenticated;

-- Objects created by future application migrations run as postgres should
-- also start private. Deliberate direct-access features must use a reviewed
-- migration with explicit narrow grants and policies.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- This event-trigger function is infrastructure, not a PostgREST RPC.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
    FROM PUBLIC, anon, authenticated;

-- Fail atomically if a direct table grant remains.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    ) THEN
        RAISE EXCEPTION
            'direct public-table privileges remain for anon/authenticated';
    END IF;
END
$$;

COMMIT;

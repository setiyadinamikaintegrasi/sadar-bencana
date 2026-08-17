BEGIN;

-- Local self-hosted auth (replaces Supabase Auth for the open-source deploy).
-- The Go API issues HS256 JWTs with the same claims the existing auth
-- middleware expects (sub = user id, email), so no other code changes.
CREATE TABLE IF NOT EXISTS local_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

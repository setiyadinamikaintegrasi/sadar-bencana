BEGIN;

-- Link an EWS subscriber to its Supabase Auth user (one-to-one).
-- Nullable so pre-existing/seed subscribers (created by admin) stay valid.
ALTER TABLE ews_subscribers
    ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS idx_ews_subscribers_auth_user
    ON ews_subscribers (auth_user_id);

COMMIT;

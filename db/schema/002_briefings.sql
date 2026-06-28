-- =============================================================================
-- 002_briefings.sql — AI briefing storage
-- Project : Sadar Bencana (Risk Monitor)
-- Engine  : PostgreSQL 16
-- Notes   : Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- briefings — AI-generated daily/event briefings from local LLM (Gemma4-E4B)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefings (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    briefing_type VARCHAR(32)  NOT NULL DEFAULT 'daily'
                    CHECK (briefing_type IN ('daily', 'event', 'weekly')),
    summary       TEXT         NOT NULL,
    event_ids     UUID[]       DEFAULT '{}',
    event_count   INTEGER      DEFAULT 0,
    model         VARCHAR(64),
    prompt_hash   VARCHAR(64),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_created_desc
    ON briefings (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_briefings_type_date
    ON briefings (briefing_type, created_at DESC);

COMMIT;

SELECT 'briefings' AS table_name, count(*) AS rows FROM briefings;

-- =============================================================================
-- 001_init.sql — Reinsurance Risk Monitor baseline schema
-- Project : Reinsurance Risk Monitor (PT Tugure)
-- Engine  : PostgreSQL 16
-- Notes   : Idempotent. Safe to re-run inside docker compose via init-db.sh.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- events — normalized disaster / earthquake events from all connectors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id     VARCHAR(255) NOT NULL,
    source       VARCHAR(64)  NOT NULL,
    event_type   VARCHAR(64)  NOT NULL,
    magnitude    FLOAT,
    latitude     FLOAT,
    longitude    FLOAT,
    place        TEXT,
    event_time   TIMESTAMPTZ,
    url          TEXT,
    severity     VARCHAR(32),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Composite uniqueness: source + its native event_id must be unique together.
    CONSTRAINT uq_events_source_event_id UNIQUE (source, event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_event_time_desc
    ON events (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_source
    ON events (source);

-- ---------------------------------------------------------------------------
-- event_sources — registry of connector feeds (BMKG, USGS, GDACS, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_sources (
    id               SERIAL       PRIMARY KEY,
    name             VARCHAR(64)  NOT NULL,
    feed_url         TEXT,
    connector_class  VARCHAR(128),
    last_fetched_at  TIMESTAMPTZ,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_event_sources_name UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- alerts — notifications / escalations generated from events or risk scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id      UUID         REFERENCES events (id) ON DELETE CASCADE,
    alert_type    VARCHAR(64)  NOT NULL,
    severity      VARCHAR(32)  NOT NULL,
    message       TEXT,
    acknowledged  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_event_id
    ON alerts (event_id);

-- ---------------------------------------------------------------------------
-- risk_scores — generic score store for events, regions, or portfolios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_scores (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type   VARCHAR(32)  NOT NULL
                    CHECK (entity_type IN ('event', 'region', 'portfolio')),
    entity_id     VARCHAR(128) NOT NULL,
    score         FLOAT        NOT NULL,
    factors       JSONB,
    calculated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_entity
    ON risk_scores (entity_type, entity_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification helpers (informational, safe to run repeatedly)
-- ---------------------------------------------------------------------------
SELECT 'events'        AS table_name, count(*) AS rows FROM events
UNION ALL SELECT 'event_sources', count(*) FROM event_sources
UNION ALL SELECT 'alerts',        count(*) FROM alerts
UNION ALL SELECT 'risk_scores',   count(*) FROM risk_scores;

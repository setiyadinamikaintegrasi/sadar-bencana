BEGIN;

ALTER TABLE ews_notification_log
    ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE TABLE IF NOT EXISTS disaster_observability_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correlation_id  UUID NOT NULL,
    stage           VARCHAR(64) NOT NULL,
    source_name     VARCHAR(64),
    peril_type      VARCHAR(64),
    severity        VARCHAR(32),
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    duration_ms     BIGINT,
    error_code      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disaster_observability_trace
    ON disaster_observability_events (correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_disaster_observability_stage
    ON disaster_observability_events (stage, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_disaster_observability_failure
    ON disaster_observability_events (source_name, occurred_at DESC)
    WHERE success = FALSE;

COMMIT;

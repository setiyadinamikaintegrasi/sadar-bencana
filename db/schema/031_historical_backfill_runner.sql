BEGIN;

ALTER TABLE historical_datasets
    ADD COLUMN IF NOT EXISTS manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS resource_format VARCHAR(8) NOT NULL DEFAULT 'json'
        CHECK (resource_format IN ('json','csv'));

CREATE TABLE IF NOT EXISTS historical_backfill_rejections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES historical_backfill_jobs(id) ON DELETE CASCADE,
    source_record_id VARCHAR(255),
    reason VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (job_id, source_record_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_historical_backfill_rejections_job
    ON historical_backfill_rejections (job_id, created_at);

COMMIT;

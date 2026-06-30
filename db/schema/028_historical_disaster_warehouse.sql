BEGIN;

CREATE TABLE IF NOT EXISTS administrative_boundaries (
    code VARCHAR(32) PRIMARY KEY,
    name TEXT NOT NULL,
    level VARCHAR(16) NOT NULL CHECK (level IN ('province','regency','district','village')),
    parent_code VARCHAR(32) REFERENCES administrative_boundaries(code),
    valid_from DATE,
    valid_to DATE,
    geometry JSONB,
    source_name VARCHAR(64) NOT NULL,
    dataset_version VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_datasets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name VARCHAR(64) NOT NULL,
    dataset_version VARCHAR(128) NOT NULL,
    data_vintage DATE,
    source_url TEXT,
    attribution TEXT NOT NULL,
    license TEXT,
    payload_checksum CHAR(64) NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_name, dataset_version, payload_checksum)
);

CREATE TABLE IF NOT EXISTS historical_disaster_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id UUID NOT NULL REFERENCES historical_datasets(id) ON DELETE RESTRICT,
    source_record_id VARCHAR(255) NOT NULL,
    peril_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    administrative_code VARCHAR(32) NOT NULL REFERENCES administrative_boundaries(code),
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    title TEXT,
    raw_payload JSONB NOT NULL,
    payload_checksum CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, source_record_id, payload_checksum)
);

CREATE INDEX IF NOT EXISTS idx_historical_events_region_time
    ON historical_disaster_events (administrative_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_events_peril_time
    ON historical_disaster_events (peril_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS historical_impact_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    historical_event_id UUID NOT NULL REFERENCES historical_disaster_events(id) ON DELETE RESTRICT,
    revision INT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    deaths INT CHECK (deaths IS NULL OR deaths >= 0),
    missing INT CHECK (missing IS NULL OR missing >= 0),
    injured INT CHECK (injured IS NULL OR injured >= 0),
    displaced INT CHECK (displaced IS NULL OR displaced >= 0),
    houses_damaged INT CHECK (houses_damaged IS NULL OR houses_damaged >= 0),
    loss_amount NUMERIC(20,2) CHECK (loss_amount IS NULL OR loss_amount >= 0),
    currency VARCHAR(8),
    source_record_id VARCHAR(255) NOT NULL,
    correction_of UUID REFERENCES historical_impact_revisions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (historical_event_id, revision)
);

CREATE TABLE IF NOT EXISTS historical_backfill_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id UUID NOT NULL REFERENCES historical_datasets(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','failed')),
    checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_count BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id)
);

COMMIT;

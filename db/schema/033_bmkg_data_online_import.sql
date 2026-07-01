BEGIN;

ALTER TABLE administrative_boundaries
    ADD COLUMN IF NOT EXISTS min_longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS min_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS max_longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS max_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS geometry_checksum CHAR(64);

CREATE INDEX IF NOT EXISTS idx_administrative_boundaries_bbox
    ON administrative_boundaries
    (min_longitude, max_longitude, min_latitude, max_latitude);

CREATE TABLE IF NOT EXISTS historical_import_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name VARCHAR(64) NOT NULL,
    dataset_version VARCHAR(128) NOT NULL,
    original_filename TEXT NOT NULL,
    payload_checksum CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'staged'
        CHECK (status IN ('staged','imported','rejected')),
    total_records INT NOT NULL DEFAULT 0 CHECK (total_records >= 0),
    resolved_records INT NOT NULL DEFAULT 0 CHECK (resolved_records >= 0),
    rejected_records INT NOT NULL DEFAULT 0 CHECK (rejected_records >= 0),
    imported_records INT NOT NULL DEFAULT 0 CHECK (imported_records >= 0),
    actor_email TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (source_name, dataset_version, payload_checksum)
);

CREATE TABLE IF NOT EXISTS historical_import_staging (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES historical_import_batches(id) ON DELETE CASCADE,
    source_record_id VARCHAR(255) NOT NULL,
    peril_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    administrative_code VARCHAR(32) REFERENCES administrative_boundaries(code),
    resolution_status VARCHAR(24) NOT NULL DEFAULT 'boundary_unresolved'
        CHECK (resolution_status IN ('resolved','boundary_unresolved','invalid')),
    magnitude DOUBLE PRECISION,
    depth_km DOUBLE PRECISION,
    raw_payload JSONB NOT NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_import_staging_resolution
    ON historical_import_staging (batch_id, resolution_status);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS source_records (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name       VARCHAR(64)  NOT NULL,
    source_record_id  VARCHAR(255) NOT NULL,
    source_type       VARCHAR(32)  NOT NULL
        CHECK (source_type IN ('official', 'sensor', 'institutional', 'media', 'citizen')),
    source_url        TEXT,
    attribution       TEXT,
    observed_at       TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    ingested_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    raw_payload       JSONB        NOT NULL,
    payload_checksum  CHAR(64)     NOT NULL,
    CONSTRAINT uq_source_record_payload
        UNIQUE (source_name, source_record_id, payload_checksum)
);

CREATE INDEX IF NOT EXISTS idx_source_records_identity
    ON source_records (source_name, source_record_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_records_published
    ON source_records (published_at DESC);

CREATE TABLE IF NOT EXISTS event_evidence (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id             UUID         REFERENCES events(id) ON DELETE CASCADE,
    source_record_id     UUID         NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    peril_type           VARCHAR(64),
    relation_type        VARCHAR(32)  NOT NULL DEFAULT 'supports'
        CHECK (relation_type IN ('supports', 'contradicts', 'updates')),
    confidence           NUMERIC(4,3) NOT NULL DEFAULT 0.500
        CHECK (confidence >= 0 AND confidence <= 1),
    freshness_expires_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_event_evidence_relation
        UNIQUE NULLS NOT DISTINCT (event_id, source_record_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_event_evidence_event
    ON event_evidence (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_evidence_source
    ON event_evidence (source_record_id);

CREATE TABLE IF NOT EXISTS impact_reports (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    impact_key          VARCHAR(255) NOT NULL,
    event_id            UUID         REFERENCES events(id) ON DELETE SET NULL,
    source_record_id    UUID         NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    location_name       TEXT,
    latitude            DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude           DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    observed_at         TIMESTAMPTZ  NOT NULL,
    deaths              INT          CHECK (deaths IS NULL OR deaths >= 0),
    missing             INT          CHECK (missing IS NULL OR missing >= 0),
    injured             INT          CHECK (injured IS NULL OR injured >= 0),
    displaced           INT          CHECK (displaced IS NULL OR displaced >= 0),
    houses_damaged      INT          CHECK (houses_damaged IS NULL OR houses_damaged >= 0),
    damage_amount       NUMERIC(20,2) CHECK (damage_amount IS NULL OR damage_amount >= 0),
    currency            VARCHAR(8),
    verification_status VARCHAR(32)  NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'corroborated', 'official')),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_impact_report_source_key
        UNIQUE (source_record_id, impact_key)
);

CREATE INDEX IF NOT EXISTS idx_impact_reports_event_observed
    ON impact_reports (event_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_impact_reports_source
    ON impact_reports (source_record_id);

CREATE TABLE IF NOT EXISTS risk_context (
    id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    context_key       VARCHAR(255) NOT NULL,
    context_type      VARCHAR(32)  NOT NULL
        CHECK (context_type IN ('hazard', 'exposure', 'vulnerability', 'capacity')),
    peril_type        VARCHAR(64),
    event_id          UUID         REFERENCES events(id) ON DELETE SET NULL,
    source_record_id  UUID         NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    administrative_code VARCHAR(32),
    data_vintage      DATE,
    values            JSONB        NOT NULL,
    area_geojson      JSONB,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_risk_context_source
        UNIQUE (context_key, context_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_context_lookup
    ON risk_context (context_key, context_type, peril_type);
CREATE INDEX IF NOT EXISTS idx_risk_context_event
    ON risk_context (event_id)
    WHERE event_id IS NOT NULL;

COMMIT;

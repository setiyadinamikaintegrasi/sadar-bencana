BEGIN;

ALTER TABLE source_records
    ADD COLUMN IF NOT EXISTS origin_source_name VARCHAR(64);

CREATE TABLE IF NOT EXISTS source_independence_rules (
    source_name         VARCHAR(64) PRIMARY KEY,
    independence_group  VARCHAR(64) NOT NULL,
    source_authority    VARCHAR(32) NOT NULL
        CHECK (source_authority IN ('official', 'sensor', 'institutional', 'media', 'citizen')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO source_independence_rules (source_name, independence_group, source_authority)
VALUES
    ('bmkg', 'bmkg', 'official'),
    ('bmkg_cap', 'bmkg', 'official'),
    ('inatews', 'bmkg', 'official'),
    ('usgs', 'usgs', 'institutional'),
    ('bnpb', 'bnpb', 'official'),
    ('pvmbg', 'pvmbg', 'official'),
    ('gdacs_fl', 'gdacs', 'institutional'),
    ('gdacs_vo', 'gdacs', 'institutional'),
    ('gvp', 'smithsonian_gvp', 'institutional'),
    ('nasa_firms', 'nasa_firms', 'sensor'),
    ('petabencana', 'petabencana', 'citizen')
ON CONFLICT (source_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_correlations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    left_event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    right_event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    peril_type          VARCHAR(64) NOT NULL,
    distance_km         DOUBLE PRECISION,
    time_delta_seconds  DOUBLE PRECISION,
    identifier_match    BOOLEAN NOT NULL DEFAULT FALSE,
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    decision            VARCHAR(16) NOT NULL
        CHECK (decision IN ('merge', 'review', 'distinct')),
    reasons             JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_version        VARCHAR(32) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (left_event_id <> right_event_id),
    CONSTRAINT uq_event_correlation_rule
        UNIQUE (left_event_id, right_event_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_event_correlations_review
    ON event_correlations (decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_correlations_left
    ON event_correlations (left_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_correlations_right
    ON event_correlations (right_event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS correlation_reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correlation_id  UUID NOT NULL UNIQUE REFERENCES event_correlations(id) ON DELETE CASCADE,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer        TEXT,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_correlation_reviews_pending
    ON correlation_reviews (created_at)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS event_merge_operations (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_type        VARCHAR(16) NOT NULL
        CHECK (operation_type IN ('merge', 'split')),
    canonical_event_id    UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    member_event_id       UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    correlation_id        UUID REFERENCES event_correlations(id) ON DELETE SET NULL,
    reverses_operation_id UUID REFERENCES event_merge_operations(id) ON DELETE RESTRICT,
    actor                 TEXT NOT NULL,
    reason                TEXT NOT NULL,
    snapshot              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (canonical_event_id <> member_event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_merge_operations_member
    ON event_merge_operations (member_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_merge_operations_canonical
    ON event_merge_operations (canonical_event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS event_merge_memberships (
    member_event_id     UUID PRIMARY KEY REFERENCES events(id) ON DELETE RESTRICT,
    canonical_event_id  UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    merge_operation_id  UUID NOT NULL REFERENCES event_merge_operations(id) ON DELETE RESTRICT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (canonical_event_id <> member_event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_merge_memberships_canonical
    ON event_merge_memberships (canonical_event_id)
    WHERE active = TRUE;

COMMIT;

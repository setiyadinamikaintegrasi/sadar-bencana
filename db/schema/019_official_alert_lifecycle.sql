BEGIN;

CREATE TABLE IF NOT EXISTS official_alerts (
    id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              VARCHAR(64)  NOT NULL,
    source_alert_id     VARCHAR(255) NOT NULL,
    revision            INT          NOT NULL CHECK (revision > 0),
    message_type        VARCHAR(16)  NOT NULL DEFAULT 'alert'
        CHECK (message_type IN ('alert', 'update', 'cancel')),
    status              VARCHAR(16)  NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'updated', 'expired', 'cancelled')),
    sent_at             TIMESTAMPTZ  NOT NULL,
    effective_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    headline            TEXT,
    description         TEXT,
    area_geojson        JSONB,
    raw_payload         JSONB        NOT NULL,
    payload_checksum    CHAR(64)     NOT NULL,
    previous_alert_id   UUID         REFERENCES official_alerts (id) ON DELETE SET NULL,
    is_current          BOOLEAN      NOT NULL DEFAULT TRUE,
    ingested_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_official_alert_revision
        UNIQUE (source, source_alert_id, revision),
    CONSTRAINT uq_official_alert_payload
        UNIQUE (source, source_alert_id, payload_checksum)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_official_alert_current
    ON official_alerts (source, source_alert_id)
    WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_official_alerts_current_status
    ON official_alerts (status, sent_at DESC)
    WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_official_alerts_expiry
    ON official_alerts (expires_at)
    WHERE is_current AND status = 'active' AND expires_at IS NOT NULL;

COMMIT;

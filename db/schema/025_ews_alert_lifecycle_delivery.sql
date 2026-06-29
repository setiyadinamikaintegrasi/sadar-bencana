BEGIN;

ALTER TABLE ews_notification_log
    DROP CONSTRAINT IF EXISTS ews_notification_log_status_check;

ALTER TABLE ews_notification_log
    ADD COLUMN IF NOT EXISTS official_alert_id UUID
        REFERENCES official_alerts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source_alert_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS alert_revision INT,
    ADD COLUMN IF NOT EXISTS lifecycle_action VARCHAR(16),
    ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_latency_ms BIGINT,
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE ews_notification_log
    ADD CONSTRAINT ews_notification_log_status_check
    CHECK (status IN (
        'pending', 'sent', 'failed', 'skipped', 'dead_letter', 'acknowledged'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ews_official_revision_delivery
    ON ews_notification_log (
        subscriber_id, channel, source, source_alert_id, alert_revision,
        lifecycle_action
    )
    WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ews_delivery_retry
    ON ews_notification_log (next_attempt_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_ews_delivery_latency
    ON ews_notification_log (source, lifecycle_action, delivery_latency_ms)
    WHERE delivery_latency_ms IS NOT NULL;

COMMIT;

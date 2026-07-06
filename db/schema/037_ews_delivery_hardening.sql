BEGIN;

ALTER TABLE ews_subscribers
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta';

ALTER TABLE ews_notification_log
    ADD COLUMN IF NOT EXISTS delivery_kind TEXT NOT NULL DEFAULT 'alert',
    ADD COLUMN IF NOT EXISTS provider_id TEXT;

UPDATE ews_notification_log
SET delivery_kind = 'official_lifecycle'
WHERE official_alert_id IS NOT NULL
  AND delivery_kind = 'alert';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ews_notification_log_delivery_kind_check'
    ) THEN
        ALTER TABLE ews_notification_log
            ADD CONSTRAINT ews_notification_log_delivery_kind_check
            CHECK (delivery_kind IN ('alert', 'official_lifecycle', 'test'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ews_alert_delivery
    ON ews_notification_log (subscriber_id, alert_id, channel)
    WHERE alert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ews_delivery_channel_status
    ON ews_notification_log (channel, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ews_channel_settings (
    channel       TEXT PRIMARY KEY CHECK (channel IN ('telegram', 'email')),
    is_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    provider      TEXT NOT NULL,
    updated_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ews_channel_settings (channel, provider)
VALUES ('telegram', 'Telegram Bot API'), ('email', 'Resend SMTP')
ON CONFLICT (channel) DO NOTHING;

CREATE TABLE IF NOT EXISTS ews_test_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requested_by    TEXT NOT NULL,
    subscriber_id   UUID NOT NULL REFERENCES ews_subscribers(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
    is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ews_test_requests_limits
    ON ews_test_requests (requested_by, channel, requested_at DESC);

CREATE TABLE IF NOT EXISTS ews_channel_setting_audit (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel         TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
    previous_enabled BOOLEAN NOT NULL,
    new_enabled     BOOLEAN NOT NULL,
    changed_by      TEXT NOT NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ews_channel_setting_audit_changed
    ON ews_channel_setting_audit (changed_at DESC);

CREATE TABLE IF NOT EXISTS ews_channel_verifications (
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id) ON DELETE CASCADE,
    channel       TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
    verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subscriber_id, channel)
);

ALTER TABLE ews_channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_channel_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE ews_test_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_test_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE ews_channel_setting_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_channel_setting_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE ews_channel_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_channel_verifications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ews_channel_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ews_test_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ews_channel_setting_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ews_channel_verifications FROM PUBLIC, anon, authenticated;

COMMIT;

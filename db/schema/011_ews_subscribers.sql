BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Subscribers: registered notification recipients
CREATE TABLE IF NOT EXISTS ews_subscribers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT NOT NULL,
    email            TEXT UNIQUE,
    phone_whatsapp   TEXT,
    telegram_chat_id BIGINT,
    role             TEXT NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('admin','manager','analyst','viewer')),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ews_subscribers_active
    ON ews_subscribers (is_active) WHERE is_active = TRUE;

-- Notification preferences per subscriber per channel
CREATE TABLE IF NOT EXISTS ews_notification_prefs (
    subscriber_id     UUID NOT NULL REFERENCES ews_subscribers(id) ON DELETE CASCADE,
    channel           TEXT NOT NULL
                      CHECK (channel IN ('telegram','whatsapp','email')),
    min_severity      TEXT NOT NULL DEFAULT 'High'
                      CHECK (min_severity IN ('Moderate','High','Critical')),
    alert_types       TEXT[] NOT NULL DEFAULT '{}',
    quiet_hours_start TIME,
    quiet_hours_end   TIME,
    is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (subscriber_id, channel)
);

-- Delivery audit log
CREATE TABLE IF NOT EXISTS ews_notification_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id) ON DELETE CASCADE,
    alert_id      UUID REFERENCES alerts(id) ON DELETE SET NULL,
    channel       TEXT NOT NULL
                  CHECK (channel IN ('telegram','whatsapp','email')),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
    error_message TEXT,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ews_notification_log_subscriber
    ON ews_notification_log (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_ews_notification_log_alert
    ON ews_notification_log (alert_id);
CREATE INDEX IF NOT EXISTS idx_ews_notification_log_created
    ON ews_notification_log (created_at DESC);

COMMIT;

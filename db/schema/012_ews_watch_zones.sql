BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Watch zones: geographic areas a subscriber wants to monitor
CREATE TABLE IF NOT EXISTS ews_watch_zones (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id) ON DELETE CASCADE,
    label         TEXT NOT NULL,
    latitude      DOUBLE PRECISION NOT NULL
                  CHECK (latitude >= -90 AND latitude <= 90),
    longitude     DOUBLE PRECISION NOT NULL
                  CHECK (longitude >= -180 AND longitude <= 180),
    radius_km     NUMERIC(8,2) NOT NULL DEFAULT 50
                  CHECK (radius_km > 0 AND radius_km <= 5000),
    peril_types   TEXT[] NOT NULL DEFAULT '{}',
    min_magnitude NUMERIC(3,1) NOT NULL DEFAULT 5.0
                  CHECK (min_magnitude >= 0 AND min_magnitude <= 10),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ews_watch_zones_subscriber
    ON ews_watch_zones (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_ews_watch_zones_active
    ON ews_watch_zones (is_active) WHERE is_active = TRUE;

COMMIT;

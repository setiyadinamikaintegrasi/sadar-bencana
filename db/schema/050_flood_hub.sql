-- 050_flood_hub.sql
-- Prakiraan banjir sungai per gauge (Google Flood Hub) — S9-P1.
-- Indonesia tercakup Flood Hub; snapshot terbaru per gauge.

CREATE TABLE IF NOT EXISTS flood_hub_gauges (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gauge_id      TEXT NOT NULL UNIQUE,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    river_name    TEXT NOT NULL DEFAULT '',
    station_name  TEXT NOT NULL DEFAULT '',
    site_name     TEXT NOT NULL DEFAULT '',
    state         TEXT NOT NULL DEFAULT '',
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flood_hub_gauges_geo
    ON flood_hub_gauges (latitude, longitude);

CREATE TABLE IF NOT EXISTS flood_hub_forecasts (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gauge_id          TEXT NOT NULL UNIQUE REFERENCES flood_hub_gauges(gauge_id) ON DELETE CASCADE,
    severity_level    SMALLINT CHECK (severity_level IS NULL OR severity_level BETWEEN 1 AND 4),
    value             REAL,
    threshold_sev_2yr REAL CHECK (threshold_sev_2yr IS NULL OR threshold_sev_2yr >= 0),
    threshold_sev_5yr REAL CHECK (threshold_sev_5yr IS NULL OR threshold_sev_5yr >= 0),
    issued_at         TIMESTAMPTZ,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flood_hub_forecasts_severity
    ON flood_hub_forecasts (severity_level DESC);

-- Migration 005: Asset tracking tables for marine (AIS) and aviation (OpenSky)
-- M9: Marine & Aviation Risk Monitoring

-- Vessel positions from AISStream.io
CREATE TABLE IF NOT EXISTS vessel_positions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mmsi        VARCHAR(12) NOT NULL,
    name        TEXT,
    ship_type   TEXT,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    sog         DOUBLE PRECISION,  -- speed over ground (knots)
    cog         DOUBLE PRECISION,  -- course over ground (degrees)
    heading     DOUBLE PRECISION,
    nav_status  TEXT,
    destination TEXT,
    eta         TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source      VARCHAR(32) NOT NULL DEFAULT 'aisstream',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (mmsi)
);

CREATE INDEX IF NOT EXISTS idx_vessel_positions_geo
    ON vessel_positions (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_vessel_positions_ts
    ON vessel_positions (timestamp DESC);

-- Aircraft positions from OpenSky Network
CREATE TABLE IF NOT EXISTS aircraft_positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icao24          VARCHAR(8) NOT NULL,
    callsign        TEXT,
    origin_country  TEXT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    altitude        DOUBLE PRECISION,  -- barometric altitude (meters)
    velocity        DOUBLE PRECISION,  -- m/s
    heading         DOUBLE PRECISION,  -- true track (degrees)
    on_ground       BOOLEAN DEFAULT FALSE,
    vertical_rate   DOUBLE PRECISION,  -- m/s
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source          VARCHAR(32) NOT NULL DEFAULT 'opensky',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (icao24)
);

CREATE INDEX IF NOT EXISTS idx_aircraft_positions_geo
    ON aircraft_positions (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_aircraft_positions_ts
    ON aircraft_positions (timestamp DESC);

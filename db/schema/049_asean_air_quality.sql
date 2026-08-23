-- 049_asean_air_quality.sql
-- Snapshot kualitas udara stasiun ASEAN (OpenAQ ground monitoring) — S8-P6.
-- Dampak asap karhutla lintas batas: Malaysia, Singapura, Brunei, Thailand.

CREATE TABLE IF NOT EXISTS asean_air_quality (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hub_code      VARCHAR(64) NOT NULL UNIQUE,
    hub_name      TEXT NOT NULL,
    country       VARCHAR(4) NOT NULL,
    station_name  TEXT,
    station_id    INTEGER,
    pm25          REAL CHECK (pm25 IS NULL OR pm25 >= 0),
    aqi_category  TEXT,
    measured_at   TIMESTAMPTZ,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Verifikasi kejujuran data (S8-P7): umur pengukuran.
    stale_after_hours SMALLINT NOT NULL DEFAULT 24
);

CREATE INDEX IF NOT EXISTS idx_asean_air_quality_country
    ON asean_air_quality (country, pm25 DESC);

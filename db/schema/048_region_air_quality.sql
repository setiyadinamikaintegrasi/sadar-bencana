-- 048_region_air_quality.sql
-- Snapshot kualitas udara per wilayah (Open-Meteo Air Quality / CAMS) — S8-P4.
-- Konteks asap karhutla lintas batas: PM2.5, PM10, US AQI.

CREATE TABLE IF NOT EXISTS region_air_quality (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_code  VARCHAR(64) NOT NULL UNIQUE,
    pm25         REAL CHECK (pm25 IS NULL OR pm25 >= 0),
    pm10         REAL CHECK (pm10 IS NULL OR pm10 >= 0),
    us_aqi       INTEGER CHECK (us_aqi IS NULL OR (us_aqi >= 0 AND us_aqi <= 999)),
    aqi_category TEXT,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 045_weather_forecasts.sql
-- Prakiraan cuaca per wilayah besar (Open-Meteo) — S8-P1.
-- Satu baris per (region_code, forecast_date); di-upsert tiap sync.

CREATE TABLE IF NOT EXISTS weather_forecasts (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_code       VARCHAR(64) NOT NULL,
    forecast_date     DATE NOT NULL,
    rain_probability  SMALLINT CHECK (rain_probability IS NULL OR (rain_probability >= 0 AND rain_probability <= 100)),
    rain_sum_mm       REAL CHECK (rain_sum_mm IS NULL OR rain_sum_mm >= 0),
    wind_max_kmh      REAL CHECK (wind_max_kmh IS NULL OR wind_max_kmh >= 0),
    weather_code      SMALLINT,
    weather_label     TEXT,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_weather_forecasts_region_date UNIQUE (region_code, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_forecasts_region
    ON weather_forecasts (region_code, forecast_date DESC);

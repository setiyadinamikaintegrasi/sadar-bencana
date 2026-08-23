-- 047_region_daylight.sql
-- Jendela siang/malam per wilayah (sunrise-sunset.org) — S8-P3.
-- Konteks operasional: sisa jam siang utk pemadaman/evakuasi.

CREATE TABLE IF NOT EXISTS region_daylight (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_code           VARCHAR(64) NOT NULL,
    date                  DATE NOT NULL,
    sunrise               TIME,
    sunset                TIME,
    civil_twilight_begin  TIME,
    civil_twilight_end    TIME,
    day_length_seconds    INTEGER CHECK (day_length_seconds IS NULL OR day_length_seconds > 0),
    fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_region_daylight_region_date UNIQUE (region_code, date)
);

CREATE INDEX IF NOT EXISTS idx_region_daylight_region
    ON region_daylight (region_code, date DESC);

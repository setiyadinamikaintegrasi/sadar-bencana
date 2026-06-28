-- 007_news_alerts_extension.sql
-- Task 12: geolokasi berita, news_signal alerts, dan geocode_cache
BEGIN;

-- Tambah kolom geolokasi ke news_items (pastikan idempotent)
ALTER TABLE news_items
    ADD COLUMN IF NOT EXISTS lat        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lon        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS place_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_news_items_lat_lon
    ON news_items (lat, lon)
    WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- Perkaya tabel alerts dengan kolom news_signal
ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS news_item_id  UUID       REFERENCES news_items (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS geo_bucket    VARCHAR(128),
    ADD COLUMN IF NOT EXISTS source_count  INT        NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_alerts_geo_bucket
    ON alerts (geo_bucket)
    WHERE geo_bucket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_news_item_id
    ON alerts (news_item_id)
    WHERE news_item_id IS NOT NULL;

-- Tabel cache geocode (Nominatim)
CREATE TABLE IF NOT EXISTS geocode_cache (
    query_text VARCHAR(255) PRIMARY KEY,
    lat        DOUBLE PRECISION,
    lon        DOUBLE PRECISION,
    cached_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

-- 043_shakemap_overlays.sql
-- Sprint 6 S6: overlay Shakemap MMI BMKG per event gempa.
-- BMKG mempublikasikan gambar MMI (JPG) per gempa pada field `Shakemap`
-- feed TEWS (nama file <YYYYMMDDHHMMSS>.mmi.jpg). Verifikasi pixel-level:
-- peta MMI adalah kotak 5°x5° berpusat episenter (episenter pada 0.50/0.49
-- pusat gambar), dengan margin bingkai/legenda yang dapat dideteksi.
-- Gambar disimpan sebagai URL (di-host BMKG) + koordinat georeferensi;
-- overlay dirender MapLibre via image source dengan koordinat 4 sudut.
BEGIN;

CREATE TABLE IF NOT EXISTS shakemap_overlays (
    event_id      TEXT PRIMARY KEY,           -- event_id events (bmkg:...)
    shakemap_key  TEXT NOT NULL,             -- 20260820062013 (dari nama file)
    image_url     TEXT NOT NULL,
    magnitude     DOUBLE PRECISION NOT NULL,
    depth_km      DOUBLE PRECISION,
    latitude      DOUBLE PRECISION NOT NULL,  -- episenter (pusat bbox)
    longitude     DOUBLE PRECISION NOT NULL,
    min_longitude DOUBLE PRECISION NOT NULL,  -- bbox 5deg
    min_latitude  DOUBLE PRECISION NOT NULL,
    max_longitude DOUBLE PRECISION NOT NULL,
    max_latitude  DOUBLE PRECISION NOT NULL,
    felt_reports  TEXT NOT NULL DEFAULT '',   -- "Dirasakan" feed (MMI wilayah)
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shakemap_overlays_event_time
    ON shakemap_overlays (fetched_at DESC);

COMMENT ON TABLE shakemap_overlays IS
    'Shakemap MMI BMKG per gempa (gambar georeferensi bbox 5deg berpusat episenter); diisi oleh apps/worker/connectors/bmkg_shakemap.py';

COMMIT;

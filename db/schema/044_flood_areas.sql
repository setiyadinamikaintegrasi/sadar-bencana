-- 044_flood_areas.sql
-- Sprint 6 S7: status genangan banjir real-time per area RW/RT dari
-- PetaBencana.id (data BPBD Jakarta & kota mitra; /floods TopoJSON).
-- state:  0=tidak terendam 1=10-30cm 2=30-70cm 3=70-150cm 4=>150cm.
-- Poligon disimpan sebagai GeoJSON geometry (JSONB) — jumlah area aktif
-- kecil (puluhan), decoder TopoJSON dikerjakan worker.
BEGIN;

CREATE TABLE IF NOT EXISTS flood_areas (
    area_id     TEXT PRIMARY KEY,          -- geom_id PetaBencana
    area_name   TEXT NOT NULL,             -- "RT 013"
    parent_name TEXT NOT NULL DEFAULT '',  -- "LUBANG BUAYA" (kelurahan/RW)
    city_name   TEXT NOT NULL DEFAULT '',  -- "CIPAYUNG" (kecamatan)
    district    TEXT NOT NULL DEFAULT '',  -- "JAKARTA TIMUR"
    state       SMALLINT NOT NULL CHECK (state BETWEEN 1 AND 4),
    geometry    JSONB NOT NULL,            -- GeoJSON Polygon
    max_latitude  DOUBLE PRECISION NOT NULL,
    min_latitude  DOUBLE PRECISION NOT NULL,
    max_longitude DOUBLE PRECISION NOT NULL,
    min_longitude DOUBLE PRECISION NOT NULL,
    source      TEXT NOT NULL DEFAULT 'petabencana',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flood_areas_state ON flood_areas (state);
CREATE INDEX IF NOT EXISTS idx_flood_areas_bbox ON flood_areas
    (min_longitude, max_longitude, min_latitude, max_latitude);

COMMENT ON TABLE flood_areas IS
    'Status genangan banjir per area RW/RT (PetaBencana /floods, state 1-4); diisi oleh apps/worker/connectors/petabencana_flood_areas.py tiap 10 menit';

COMMIT;

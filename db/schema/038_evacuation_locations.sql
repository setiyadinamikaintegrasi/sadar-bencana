-- 038_evacuation_locations.sql
-- Lokasi evakuasi: fasilitas umum (sinkron OSM) + entri manual admin
-- (shelter/TES/TEA/posko/titik kumpul/pos SAR/gudang logistik).
-- Dilayani penuh lewat Go API; tanpa policy/grant browser (posture 035).
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS evacuation_locations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT NOT NULL,
    location_type     TEXT NOT NULL CHECK (location_type IN (
                        'shelter','tes','tea','posko_bnpb_bpbd','rumah_sakit',
                        'puskesmas','kantor_polisi','damkar','titik_kumpul',
                        'pos_sar','gudang_logistik')),
    source_type       TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source_type IN ('osm','manual')),
    source_ref        TEXT,
    latitude          DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude         DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    address           TEXT NOT NULL DEFAULT '',
    photo_url         TEXT,
    capacity          INTEGER CHECK (capacity IS NULL OR capacity >= 0),
    is_open           BOOLEAN,
    is_full           BOOLEAN,
    phone             TEXT NOT NULL DEFAULT '',
    person_in_charge  TEXT NOT NULL DEFAULT '',
    facilities        TEXT[] NOT NULL DEFAULT '{}',
    operating_hours   TEXT NOT NULL DEFAULT '',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kunci dedup upsert connector OSM.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evacuation_locations_source_ref
    ON evacuation_locations(source_ref) WHERE source_ref IS NOT NULL;

-- Prefilter bounding-box untuk list/nearest.
CREATE INDEX IF NOT EXISTS idx_evacuation_locations_geo
    ON evacuation_locations(latitude, longitude) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_evacuation_locations_type
    ON evacuation_locations(location_type) WHERE is_active = TRUE;

ALTER TABLE evacuation_locations ENABLE ROW LEVEL SECURITY;

COMMIT;

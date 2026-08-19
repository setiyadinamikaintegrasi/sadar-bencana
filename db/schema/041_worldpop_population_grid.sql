-- 041_worldpop_population_grid.sql
-- Sprint 5 S1: statistik zonal populasi (exposure) dari WorldPop.
-- Dataset: WorldPop Global 2000-2020 1km UNadj — idn_ppp_2020_1km_Aggregated_UNadj
-- (grid ~1km, disesuaikan batas admin PBB, lisensi CC-BY 4.0).
-- Diimpor sebagai titik pusat sel 1km dengan nilai populasi sel sehingga
-- statistik zonal cukup memakai ST_Contains poligon biasa (tanpa postgis_raster).
BEGIN;

-- Metadata dataset spasial: vintage & atribusi terlihat dari API.
CREATE TABLE IF NOT EXISTS spatial_datasets (
    dataset       TEXT PRIMARY KEY,
    vintage       TEXT NOT NULL,
    resolution_m  INTEGER NOT NULL,
    attribution   TEXT NOT NULL,
    source_url    TEXT NOT NULL DEFAULT '',
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    feature_count BIGINT NOT NULL DEFAULT 0
);

-- Grid populasi: satu baris per sel 1km dengan populasi > 0 (nodata & nol
-- dilewati — 2,27 juta baris untuk Indonesia alih-alih 11,3 juta sel penuh).
CREATE TABLE IF NOT EXISTS worldpop_population_grid (
    cell_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    population DOUBLE PRECISION NOT NULL CHECK (population > 0),
    geom       geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worldpop_population_grid_geom
    ON worldpop_population_grid USING GIST (geom);

-- Ringkasan zonal: total populasi + jumlah sel yang tercakup poligon.
-- ST_Contains pada geometry 4326 tepat untuk grid lon/lat (planar).
CREATE OR REPLACE FUNCTION zonal_population_summary(zone geometry(Polygon, 4326))
RETURNS TABLE (population DOUBLE PRECISION, cells BIGINT)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT COALESCE(SUM(g.population), 0)::double precision,
           COUNT(g.cell_id)::bigint
    FROM worldpop_population_grid g
    WHERE ST_Contains(zone, g.geom)
$$;

COMMENT ON TABLE worldpop_population_grid IS
    'WorldPop 2020 1km UNadj population grid (Indonesia); ingested by apps/worker/importers/worldpop_grid.py';
COMMENT ON FUNCTION zonal_population_summary(geometry) IS
    'Total populasi & jumlah sel WorldPop dalam poligon (S1 zonal exposure)';

COMMIT;

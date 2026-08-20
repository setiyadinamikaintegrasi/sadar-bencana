-- 042_worldcover_landcover_grid.sql
-- Sprint 5 S3: statistik zonal tutupan lahan (landcover) dari ESA WorldCover
-- 10m v100 (2020, CC BY 4.0) — sampel kelas per sel ~1km (dibaca dari
-- overview COG ~148m dengan stride 7; deviasi fraksi < 0,3 pp vs full-res,
-- diverifikasi pada tile Jawa).
-- Satu baris = satu sampel kelas (kode ESA: 10 Tree, 40 Crop, 50 Built,
-- 80 Water, 90 Wetland, 95 Mangrove, dst; 0 = nodata tidak disimpan).
BEGIN;

CREATE TABLE IF NOT EXISTS worldcover_landcover_grid (
    cell_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_code SMALLINT NOT NULL CHECK (class_code BETWEEN 1 AND 100),
    geom       geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worldcover_landcover_grid_geom
    ON worldcover_landcover_grid USING GIST (geom);

-- Distribusi kelas dalam poligon: jumlah sampel per kelas + fraksi.
-- Fraksi = sampel kelas / total sampel dalam poligon (sel seluruhnya
-- termasuk air — konteks penting untuk banjir/tsunami).
CREATE OR REPLACE FUNCTION zonal_landcover_summary(zone geometry(Polygon, 4326))
RETURNS TABLE (class_code SMALLINT, sample_count BIGINT, fraction DOUBLE PRECISION)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    WITH hits AS (
        SELECT g.class_code
        FROM worldcover_landcover_grid g
        WHERE ST_Contains(zone, g.geom)
    ), totals AS (
        SELECT count(*)::bigint AS total FROM hits
    )
    SELECT hits.class_code,
           count(*)::bigint AS sample_count,
           (count(*)::double precision / GREATEST(totals.total, 1)) AS fraction
    FROM hits, totals
    GROUP BY hits.class_code, totals.total
$$;

COMMENT ON TABLE worldcover_landcover_grid IS
    'ESA WorldCover 10m v100 (2020) landcover samples ~1km; ingested by apps/worker/importers/worldcover_landcover.py';
COMMENT ON FUNCTION zonal_landcover_summary(geometry) IS
    'Distribusi kelas tutupan lahan (jumlah sampel + fraksi) dalam poligon (S3)';

COMMIT;

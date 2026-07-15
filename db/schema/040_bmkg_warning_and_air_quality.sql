BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE official_alerts
    ADD COLUMN IF NOT EXISTS peril_type VARCHAR(32),
    ADD COLUMN IF NOT EXISTS severity VARCHAR(16),
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS area_name TEXT,
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE official_alerts
    DROP CONSTRAINT IF EXISTS official_alerts_peril_type_check,
    DROP CONSTRAINT IF EXISTS official_alerts_severity_check,
    DROP CONSTRAINT IF EXISTS official_alerts_coordinates_check,
    ADD CONSTRAINT official_alerts_peril_type_check
      CHECK (peril_type IS NULL OR peril_type IN ('weather', 'air_quality')),
    ADD CONSTRAINT official_alerts_severity_check
      CHECK (severity IS NULL OR severity IN ('Moderate', 'High', 'Critical')),
    ADD CONSTRAINT official_alerts_coordinates_check
      CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
      );

-- Scope validation to writes that supply geometry so legacy rows remain mutable.
ALTER TABLE official_alerts
    DROP CONSTRAINT IF EXISTS official_alerts_area_geojson_valid_check;

CREATE OR REPLACE FUNCTION validate_official_alert_area_geojson()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parsed_geometry geometry;
BEGIN
  IF NEW.area_geojson IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    parsed_geometry := ST_SetSRID(
      ST_GeomFromGeoJSON(NEW.area_geojson::text),
      4326
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'official_alerts_area_geojson_validation',
        MESSAGE = 'official_alerts.area_geojson must be valid Polygon or MultiPolygon GeoJSON';
  END;

  IF parsed_geometry IS NULL
     OR GeometryType(parsed_geometry) NOT IN ('POLYGON', 'MULTIPOLYGON')
     OR NOT ST_IsValid(parsed_geometry) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'official_alerts_area_geojson_validation',
      MESSAGE = 'official_alerts.area_geojson must be valid Polygon or MultiPolygon GeoJSON';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS official_alerts_area_geojson_validation
  ON official_alerts;

CREATE TRIGGER official_alerts_area_geojson_validation
BEFORE INSERT OR UPDATE OF area_geojson ON official_alerts
FOR EACH ROW
EXECUTE FUNCTION validate_official_alert_area_geojson();

ALTER TABLE ews_notification_log
    ADD COLUMN IF NOT EXISTS matched_watch_zone_id UUID
      REFERENCES ews_watch_zones(id) ON DELETE SET NULL;

ALTER TABLE official_source_settings
    ADD COLUMN IF NOT EXISTS expected_interval_seconds INT NOT NULL DEFAULT 600
      CHECK (expected_interval_seconds BETWEEN 60 AND 86400);

CREATE TABLE IF NOT EXISTS air_quality_observations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(64) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    station_name TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    pollutant VARCHAR(16) NOT NULL CHECK (pollutant = 'pm25'),
    value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
    unit VARCHAR(16) NOT NULL DEFAULT 'ug/m3' CHECK (unit = 'ug/m3'),
    category TEXT NOT NULL CHECK (
      category IN ('Baik', 'Sedang', 'Tidak Sehat', 'Sangat Tidak Sehat', 'Berbahaya')
    ),
    observed_at TIMESTAMPTZ NOT NULL,
    source_url TEXT,
    raw_payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    ),
    UNIQUE (source, station_id, pollutant, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_air_quality_latest
  ON air_quality_observations (source, station_id, pollutant, observed_at DESC);

ALTER TABLE air_quality_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE air_quality_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE air_quality_observations FROM PUBLIC, anon, authenticated;

INSERT INTO ews_safety_guidance (
  peril_type, language_code, content_version, content, curated_by, source_url
) VALUES
(
  'weather', 'id', 'id-v1',
  '{"before":["Pantau pembaruan peringatan resmi BMKG untuk wilayah Anda.","Amankan benda di luar ruang dan siapkan tempat berlindung yang aman."],"during":["Hindari area terbuka, pohon, baliho, dan saluran air saat cuaca ekstrem.","Ikuti arahan BMKG, BPBD, dan petugas setempat."],"after":["Periksa bahaya di sekitar sebelum kembali beraktivitas.","Tetap pantau pembaruan atau pencabutan peringatan resmi."]}',
  'SadarBencana safety editorial',
  'https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca'
),
(
  'air_quality', 'id', 'id-v1',
  '{"before":["Pantau kategori dan periode peringatan kualitas udara BMKG.","Siapkan perlindungan pernapasan sesuai arahan kesehatan resmi."],"during":["Kurangi aktivitas luar ruang, terutama untuk kelompok rentan.","Ikuti arahan BMKG, dinas kesehatan, dan pemerintah setempat."],"after":["Pantau pembaruan kualitas udara sebelum kembali beraktivitas normal.","Cari bantuan medis bila mengalami gangguan kesehatan."]}',
  'SadarBencana safety editorial',
  'https://iklim.bmkg.go.id/en/kualitas-udara-indonesia/'
)
ON CONFLICT (peril_type, language_code, content_version) DO NOTHING;

INSERT INTO official_source_settings (
  source_name, display_name, enabled, mode, default_api_url, attribution,
  terms_url, poll_interval_seconds, expected_interval_seconds, notes
) VALUES (
  'bmkg_air_quality', 'BMKG Kualitas Udara', FALSE, 'custom_api', NULL,
  'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
  'https://www.bmkg.go.id/ketentuan-penggunaan', 3600, 3600,
  'Aktifkan hanya setelah endpoint machine-readable resmi dan izin integrasi dikonfirmasi.'
) ON CONFLICT (source_name) DO NOTHING;

INSERT INTO official_source_setting_versions (
  source_name, version, configuration, api_token_encrypted, changed_by, change_reason
)
SELECT
  source_name,
  config_version,
  jsonb_build_object(
    'enabled', enabled,
    'run_mode', run_mode,
    'mode', mode,
    'adapter_version', adapter_version,
    'field_mapping', field_mapping,
    'custom_api_url', custom_api_url,
    'poll_interval_seconds', poll_interval_seconds,
    'expected_interval_seconds', expected_interval_seconds
  ),
  api_token_encrypted,
  'migration',
  'Initial BMKG air-quality disabled baseline'
FROM official_source_settings
WHERE source_name = 'bmkg_air_quality'
  AND config_version = 1
ON CONFLICT (source_name, version) DO NOTHING;

COMMIT;

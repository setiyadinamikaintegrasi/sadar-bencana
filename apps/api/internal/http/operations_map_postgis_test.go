package http

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	appdb "github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/db"
)

const operationMapPostGISSchema = `
CREATE TABLE official_source_settings (
    source_name TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    run_mode TEXT NOT NULL,
    expected_interval_seconds INT NOT NULL DEFAULT 60
);

CREATE TABLE official_alerts (
    id UUID PRIMARY KEY,
    source TEXT NOT NULL,
    source_alert_id TEXT NOT NULL,
    revision INT NOT NULL,
    status TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    effective_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    headline TEXT,
    peril_type TEXT,
    severity TEXT,
    source_url TEXT,
    area_geojson JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_current BOOLEAN NOT NULL
);

CREATE TABLE air_quality_observations (
    id UUID PRIMARY KEY,
    source TEXT NOT NULL,
    station_id TEXT NOT NULL,
    station_name TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    pollutant TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    source_url TEXT,
    ingested_at TIMESTAMPTZ NOT NULL
);
`

func TestOperationMapAlertsPostGISUsesValidatedSelectedGeometry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openOperationMapPostGIS(t)
	if _, err := db.Exec(operationMapPostGISSchema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO official_source_settings (source_name, enabled, run_mode) VALUES ('bmkg', TRUE, 'active')`); err != nil {
		t.Fatalf("create source: %v", err)
	}
	if _, err := db.Exec(`
INSERT INTO official_alerts (
    id, source, source_alert_id, revision, status, sent_at, effective_at, expires_at,
    headline, peril_type, severity, source_url, area_geojson, latitude, longitude, is_current
) VALUES
    ('00000000-0000-0000-0000-000000000001', 'bmkg', 'legacy-malformed', 1, 'active', now() - interval '3 minutes', now() - interval '5 minutes', now() + interval '1 hour', 'Legacy', 'weather', 'High', NULL, '{"type":"Polygon","coordinates":[]}', -6.2, 106.8, TRUE),
    ('00000000-0000-0000-0000-000000000002', 'bmkg', 'topology-invalid', 1, 'active', now() - interval '2 minutes', now() - interval '5 minutes', now() + interval '1 hour', 'Topology', 'weather', 'High', NULL, '{"type":"Polygon","coordinates":[[[106.7,-6.3],[107.0,-6.0],[106.7,-6.0],[107.0,-6.3],[106.7,-6.3]]]}', -6.2, 106.8, TRUE),
    ('00000000-0000-0000-0000-000000000003', 'bmkg', 'area-outside-point-inside', 1, 'active', now() - interval '1 minute', now() - interval '5 minutes', now() + interval '1 hour', 'Outside', 'weather', 'High', NULL, '{"type":"Polygon","coordinates":[[[139.5,35.5],[139.9,35.5],[139.9,35.9],[139.5,35.9],[139.5,35.5]]]}', -6.2, 106.8, TRUE),
    ('00000000-0000-0000-0000-000000000004', 'bmkg', 'area-inside-point-outside', 1, 'active', now(), now() - interval '5 minutes', now() + interval '1 hour', 'Inside', 'weather', 'High', NULL, '{"type":"Polygon","coordinates":[[[106.7,-6.4],[107.1,-6.4],[107.1,-6.0],[106.7,-6.0],[106.7,-6.4]]]}', 35.7, 139.7, TRUE),
    ('00000000-0000-0000-0000-000000000005', 'bmkg', 'wgs84-invalid', 1, 'active', now() - interval '30 seconds', now() - interval '5 minutes', now() + interval '1 hour', 'Invalid bounds', 'weather', 'High', NULL, '{"type":"Polygon","coordinates":[[[106.7,-6.4],[200,-6.4],[200,-6.0],[106.7,-6.0],[106.7,-6.4]]]}', -6.2, 106.8, TRUE)
`); err != nil {
		t.Fatalf("create alerts: %v", err)
	}

	body := requestOperationMap(t, OperationMapAlerts(db), "/api/v1/map/operations/alerts?bbox=106.7,-6.4,107.1,-6.0")
	features := operationMapFeaturesByID(t, body)
	if _, exists := features["bmkg:area-outside-point-inside"]; exists {
		t.Fatalf("out-of-bbox selected geometry was included: %#v", features)
	}
	for _, id := range []string{"bmkg:legacy-malformed", "bmkg:topology-invalid", "bmkg:area-inside-point-outside", "bmkg:wgs84-invalid"} {
		if _, exists := features[id]; !exists {
			t.Fatalf("missing expected alert %q: %#v", id, features)
		}
	}
	if got := features["bmkg:legacy-malformed"]["geometry"].(map[string]any)["type"]; got != "Point" {
		t.Fatalf("legacy geometry type = %#v, want Point fallback", got)
	}
	if got := features["bmkg:topology-invalid"]["geometry"].(map[string]any)["type"]; got != "Point" {
		t.Fatalf("topology-invalid geometry type = %#v, want Point fallback", got)
	}
	if got := features["bmkg:area-inside-point-outside"]["geometry"].(map[string]any)["type"]; got != "Polygon" {
		t.Fatalf("area-inside geometry type = %#v, want Polygon", got)
	}
	if got := features["bmkg:wgs84-invalid"]["geometry"].(map[string]any)["type"]; got != "Point" {
		t.Fatalf("WGS84-invalid geometry type = %#v, want Point fallback", got)
	}
}

func TestOperationMapAirQualityPostGISUsesLatestAsOfSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openOperationMapPostGIS(t)
	if _, err := db.Exec(operationMapPostGISSchema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO official_source_settings (source_name, enabled, run_mode, expected_interval_seconds) VALUES ('bmkg_air_quality', TRUE, 'active', 60)`); err != nil {
		t.Fatalf("create source: %v", err)
	}
	referenceTime := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	if _, err := db.Exec(`
INSERT INTO air_quality_observations (
    id, source, station_id, station_name, latitude, longitude, pollutant, value,
    unit, category, observed_at, source_url, ingested_at
) VALUES
    ('10000000-0000-0000-0000-000000000001', 'bmkg', 'station-1', 'Station 1', -6.2, 106.8, 'pm25', 160, 'ug/m3', 'Berbahaya', $1, NULL, $1),
    ('10000000-0000-0000-0000-000000000002', 'bmkg', 'station-1', 'Station 1', -6.2, 106.8, 'pm25', 66, 'ug/m3', 'Tidak Sehat', $2, NULL, $2),
    ('10000000-0000-0000-0000-000000000003', 'bmkg', 'station-2', 'Station 2', -6.25, 106.85, 'pm25', 55, 'ug/m3', 'Sedang', $2, NULL, $2),
    ('10000000-0000-0000-0000-000000000004', 'bmkg', 'station-moving', 'Moving Station', -6.2, 106.8, 'pm25', 88, 'ug/m3', 'Tidak Sehat', $1, NULL, $1),
    ('10000000-0000-0000-0000-000000000005', 'bmkg', 'station-moving', 'Moving Station', -7.2, 106.8, 'pm25', 44, 'ug/m3', 'Sedang', $2, NULL, $2)
`, referenceTime.Add(-10*time.Minute), referenceTime.Add(-time.Minute)); err != nil {
		t.Fatalf("create observations: %v", err)
	}

	body := requestOperationMap(t, OperationMapAirQuality(db), "/api/v1/map/operations/air-quality?bbox=106.7,-6.4,107.1,-6.0&at="+referenceTime.Format(time.RFC3339))
	features := body["features"].([]any)
	if got := len(features); got != 2 {
		t.Fatalf("feature count = %d, want one latest-as-of feature per station/pollutant", got)
	}
	seenIDs := map[string]bool{}
	var stationOne map[string]any
	for _, raw := range features {
		feature := raw.(map[string]any)
		id := feature["id"].(string)
		if seenIDs[id] {
			t.Fatalf("duplicate feature ID %q", id)
		}
		seenIDs[id] = true
		if id == "bmkg:station-1:pm25" {
			stationOne = feature["properties"].(map[string]any)
		}
	}
	if stationOne == nil || stationOne["value"] != 66.0 {
		t.Fatalf("station 1 latest-as-of properties = %#v, want value 66", stationOne)
	}
	if stationOne["stale"] != false {
		t.Fatalf("station 1 stale = %#v, want false at supplied reference time", stationOne["stale"])
	}
	if seenIDs["bmkg:station-moving:pm25"] {
		t.Fatalf("older in-bbox station position leaked after latest-as-of moved outside the viewport: %#v", seenIDs)
	}
}

func operationMapFeaturesByID(t *testing.T, body map[string]any) map[string]map[string]any {
	t.Helper()
	features := body["features"].([]any)
	byID := make(map[string]map[string]any, len(features))
	for _, raw := range features {
		feature := raw.(map[string]any)
		byID[feature["id"].(string)] = feature
	}
	return byID
}

func openOperationMapPostGIS(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required for PostGIS integration test")
	}
	admin, err := appdb.New(databaseURL)
	if err != nil {
		t.Fatalf("open admin database: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	if err := admin.PingContext(ctx); err != nil {
		admin.Close()
		t.Fatalf("ping admin database: %v", err)
	}
	if err := admin.QueryRowContext(ctx, `SELECT PostGIS_Version()`).Scan(new(string)); err != nil {
		admin.Close()
		t.Fatalf("TEST_DATABASE_URL must point to a PostGIS-enabled database: %v", err)
	}
	schema := fmt.Sprintf("operation_map_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		admin.Close()
		t.Fatalf("create schema: %v", err)
	}

	scopedURL, err := url.Parse(databaseURL)
	if err != nil {
		admin.Close()
		t.Fatalf("parse database URL: %v", err)
	}
	query := scopedURL.Query()
	query.Set("search_path", schema+",public")
	scopedURL.RawQuery = query.Encode()
	db, err := appdb.New(scopedURL.String())
	if err != nil {
		admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
		admin.Close()
		t.Fatalf("open isolated database: %v", err)
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
		admin.Close()
		failf := "ping isolated database: %v"
		t.Fatalf(failf, err)
	}
	t.Cleanup(func() {
		db.Close()
		if _, err := admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`); err != nil {
			t.Errorf("drop schema: %v", err)
		}
		admin.Close()
	})
	return db
}

func TestOperationMapEventsPostGISUsesPerPerilDefaultWindows(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openOperationMapPostGIS(t)
	if _, err := db.Exec(`
CREATE TABLE events (
    id UUID PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL,
    source VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    magnitude FLOAT,
    latitude FLOAT,
    longitude FLOAT,
    place TEXT,
    event_time TIMESTAMPTZ,
    url TEXT,
    severity VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`); err != nil {
		t.Fatalf("create events table: %v", err)
	}
	if _, err := db.Exec(`
INSERT INTO events (id, source, event_id, event_type, magnitude, latitude, longitude, place, event_time, severity) VALUES
    ('00000000-0000-0000-0000-000000000101', 'bmkg', 'eq-recent', 'earthquake', 4.5, -6.2, 106.8, 'Jakarta', now() - interval '1 hour', 'High'),
    ('00000000-0000-0000-0000-000000000102', 'gvp', 'volcano-30d', 'volcano', NULL, -6.2, 106.8, 'Semeru', now() - interval '30 days', 'High'),
    ('00000000-0000-0000-0000-000000000103', 'gvp', 'volcano-200d', 'volcano', NULL, -6.2, 106.8, 'Semeru', now() - interval '200 days', 'High'),
    ('00000000-0000-0000-0000-000000000104', 'petabencana', 'flood-200d', 'flood', NULL, -6.2, 106.8, 'Jakarta', now() - interval '200 days', 'High'),
    ('00000000-0000-0000-0000-000000000105', 'petabencana', 'flood-400d', 'flood', NULL, -6.2, 106.8, 'Jakarta', now() - interval '400 days', 'High')
`); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	// Tampilan live (tanpa from/to): gempa 72 jam, vulkanik 90 hari,
	// banjir 365 hari — jadi peril beraktivitas jarang ikut tampil.
	body := requestOperationMap(t, OperationMapEvents(db), "/api/v1/map/operations/events?bbox=105,-9,124,5&zoom=8")
	features := operationMapFeaturesByID(t, body)
	for _, id := range []string{"bmkg:eq-recent", "gvp:volcano-30d", "petabencana:flood-200d"} {
		if _, exists := features[id]; !exists {
			t.Fatalf("default window missing %q: %#v", id, features)
		}
	}
	for _, id := range []string{"gvp:volcano-200d", "petabencana:flood-400d"} {
		if _, exists := features[id]; exists {
			t.Fatalf("default window included out-of-window %q: %#v", id, features)
		}
	}

	// Window eksplisit (replay timeline): satu jendela 72 jam untuk semua peril.
	from := url.QueryEscape(time.Now().UTC().Add(-72 * time.Hour).Format(time.RFC3339))
	to := url.QueryEscape(time.Now().UTC().Format(time.RFC3339))
	body = requestOperationMap(t, OperationMapEvents(db), "/api/v1/map/operations/events?bbox=105,-9,124,5&zoom=8&from="+from+"&to="+to)
	features = operationMapFeaturesByID(t, body)
	if _, exists := features["bmkg:eq-recent"]; !exists {
		t.Fatalf("explicit window missing recent event: %#v", features)
	}
	for _, id := range []string{"gvp:volcano-30d", "petabencana:flood-200d"} {
		if _, exists := features[id]; exists {
			t.Fatalf("explicit 72h window included %q: %#v", id, features)
		}
	}
}

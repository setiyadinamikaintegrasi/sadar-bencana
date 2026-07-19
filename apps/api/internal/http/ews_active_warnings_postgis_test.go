package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	appdb "github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/db"
)

const activeWarningsPostGISSchema = `
CREATE TABLE ews_subscribers (
    id UUID PRIMARY KEY,
    auth_user_id UUID UNIQUE
);

CREATE TABLE ews_watch_zones (
    id UUID PRIMARY KEY,
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id),
    label TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_km NUMERIC(8, 2) NOT NULL,
    peril_types TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE official_alerts (
    id UUID PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    message_type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    effective_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    peril_type VARCHAR(32),
    severity VARCHAR(16),
    category TEXT,
    headline TEXT,
    description TEXT,
    area_name TEXT,
    area_geojson JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source_url TEXT,
    raw_payload JSONB NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE official_source_settings (
    source_name VARCHAR(64) PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    run_mode VARCHAR(16) NOT NULL
);

CREATE TABLE ews_safety_guidance (
    peril_type VARCHAR(32) NOT NULL,
    language_code VARCHAR(8) NOT NULL,
    content JSONB NOT NULL,
    source_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
`

const activeWarningsPostGISFixtures = `
INSERT INTO official_source_settings (source_name, enabled, run_mode)
VALUES ('bmkg_cap', TRUE, 'active');

INSERT INTO ews_subscribers (id, auth_user_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

INSERT INTO ews_watch_zones (
    id, subscriber_id, label, latitude, longitude, radius_km,
    peril_types, is_active, created_at
) VALUES
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Shared', -6.15, 106.85, 25, '{}', TRUE, now() - interval '2 hours'),
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Shared', -6.15, 106.85, 25, '{}', TRUE, now() - interval '3 hours'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'First', -6.15, 106.85, 25, '{}', TRUE, now() - interval '2 hours'),
	('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Sydney', -33.86, 151.20, 10, '{}', TRUE, now() - interval '4 hours'),
    ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Inactive', -6.15, 106.85, 25, '{}', FALSE, now() - interval '4 hours'),
    ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Wrong peril', -6.15, 106.85, 25, '{air_quality}', TRUE, now() - interval '4 hours'),
    ('30000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000002', 'Subscriber two', -6.15, 106.85, 25, '{}', TRUE, now() - interval '1 hour');

INSERT INTO ews_safety_guidance (
    peril_type, language_code, content, source_url, is_active
) VALUES (
    'weather', 'id', '{"during":["Follow BMKG guidance."]}',
    'https://example.test/guidance', TRUE
);

INSERT INTO official_alerts (
    id, source, message_type, status, sent_at, effective_at, expires_at,
    peril_type, severity, headline, area_geojson, latitude, longitude,
    raw_payload, is_current
) VALUES
    ('40000000-0000-0000-0000-000000000001', 'bmkg_cap', 'alert', 'active', now() - interval '20 minutes', now() - interval '10 minutes', now() + interval '1 hour', 'weather', 'High', 'Valid polygon', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{"secret":"must-not-leak"}', TRUE),
    ('40000000-0000-0000-0000-000000000002', 'bmkg_cap', 'alert', 'active', now() - interval '15 minutes', now() - interval '5 minutes', now() + interval '1 hour', 'weather', 'Moderate', 'Point fallback', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.00],[106.70,-6.00],[107.00,-6.30],[106.70,-6.30]]]}', -6.16, 106.86, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000003', 'bmkg_cap', 'alert', 'active', now() - interval '14 minutes', NULL, now() + interval '1 hour', 'weather', 'High', 'Invalid polygon only', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.00],[106.70,-6.00],[107.00,-6.30],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000004', 'bmkg_cap', 'alert', 'active', now() - interval '13 minutes', NULL, now() + interval '1 hour', 'weather', 'High', 'Outside', '{"type":"Polygon","coordinates":[[[139.50,35.50],[139.90,35.50],[139.90,35.90],[139.50,35.90],[139.50,35.50]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000005', 'bmkg_cap', 'alert', 'active', now(), now() + interval '1 hour', now() + interval '2 hours', 'weather', 'High', 'Future', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000006', 'bmkg_cap', 'alert', 'active', now() - interval '2 hours', NULL, now() - interval '1 minute', 'weather', 'High', 'Expired', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000007', 'bmkg_cap', 'alert', 'active', now() - interval '12 minutes', NULL, now() + interval '1 hour', 'weather', 'High', 'Historical revision', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', FALSE),
    ('40000000-0000-0000-0000-000000000008', 'bmkg_cap', 'update', 'updated', now() - interval '11 minutes', NULL, now() + interval '1 hour', 'weather', 'High', 'Not active', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000009', 'bmkg_cap', 'alert', 'active', now() - interval '10 minutes', NULL, now() + interval '1 hour', NULL, 'High', 'Missing peril', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000010', 'bmkg_cap', 'alert', 'active', now() - interval '9 minutes', NULL, now() + interval '1 hour', 'weather', NULL, 'Missing severity', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE),
    ('40000000-0000-0000-0000-000000000011', 'other_official', 'alert', 'active', now() - interval '8 minutes', NULL, now() + interval '1 hour', 'weather', 'High', 'Not BMKG', '{"type":"Polygon","coordinates":[[[106.70,-6.30],[107.00,-6.30],[107.00,-6.00],[106.70,-6.00],[106.70,-6.30]]]}', NULL, NULL, '{}', TRUE);
`

func TestEWSMeActiveWarningsPostGIS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openActiveWarningsPostGIS(t)
	if _, err := db.Exec(activeWarningsPostGISSchema + activeWarningsPostGISFixtures); err != nil {
		t.Fatalf("create fixture: %v", err)
	}

	subscriberOne := requestActiveWarnings(t, db, "20000000-0000-0000-0000-000000000001")
	assertActiveWarningIDs(t, subscriberOne, []string{
		"40000000-0000-0000-0000-000000000001",
		"40000000-0000-0000-0000-000000000002",
	})
	wantZoneIDs := []string{
		"30000000-0000-0000-0000-000000000001",
		"30000000-0000-0000-0000-000000000002",
		"30000000-0000-0000-0000-000000000003",
	}
	wantZoneLabels := []string{"Shared", "First", "Shared"}
	for _, warning := range subscriberOne.Data {
		if !reflect.DeepEqual(warning.MatchedWatchZoneIDs, wantZoneIDs) ||
			!reflect.DeepEqual(warning.MatchedWatchZoneLabels, wantZoneLabels) {
			t.Fatalf("warning %s zones = %v / %v, want aligned %v / %v",
				warning.ID, warning.MatchedWatchZoneIDs, warning.MatchedWatchZoneLabels,
				wantZoneIDs, wantZoneLabels)
		}
	}
	for _, warning := range subscriberOne.RawData {
		if _, exists := warning["raw_payload"]; exists {
			t.Fatalf("raw_payload leaked in response: %#v", warning)
		}
	}

	subscriberTwo := requestActiveWarnings(t, db, "20000000-0000-0000-0000-000000000002")
	assertActiveWarningIDs(t, subscriberTwo, []string{
		"40000000-0000-0000-0000-000000000001",
		"40000000-0000-0000-0000-000000000002",
	})
	for _, warning := range subscriberTwo.Data {
		if !reflect.DeepEqual(warning.MatchedWatchZoneIDs, []string{"30000000-0000-0000-0000-000000000101"}) ||
			!reflect.DeepEqual(warning.MatchedWatchZoneLabels, []string{"Subscriber two"}) {
			t.Fatalf("subscriber isolation failed for warning %s: %v / %v",
				warning.ID, warning.MatchedWatchZoneIDs, warning.MatchedWatchZoneLabels)
		}
	}

	if _, err := db.Exec(`UPDATE official_source_settings SET enabled=FALSE WHERE source_name='bmkg_cap'`); err != nil {
		t.Fatalf("disable source: %v", err)
	}
	assertActiveWarningIDs(t,
		requestActiveWarnings(t, db, "20000000-0000-0000-0000-000000000001"),
		[]string{},
	)
}

type activeWarningsResponse struct {
	Data    []EWSActiveWarning
	RawData []map[string]any
}

func requestActiveWarnings(t *testing.T, db *sql.DB, authUserID string) activeWarningsResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set(ctxAuthUserID, authUserID)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/ews/me/active-warnings", nil)
	EWSMeActiveWarnings(db)(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status for %s = %d, want 200: %s", authUserID, recorder.Code, recorder.Body.String())
	}
	var typed struct {
		Data []EWSActiveWarning `json:"data"`
	}
	var raw struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &typed); err != nil {
		t.Fatalf("decode typed response: %v", err)
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw response: %v", err)
	}
	return activeWarningsResponse{Data: typed.Data, RawData: raw.Data}
}

func assertActiveWarningIDs(t *testing.T, response activeWarningsResponse, want []string) {
	t.Helper()
	got := make([]string, 0, len(response.Data))
	for _, warning := range response.Data {
		got = append(got, warning.ID)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("warning IDs = %v, want %v", got, want)
	}
}

func openActiveWarningsPostGIS(t *testing.T) *sql.DB {
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
	schema := fmt.Sprintf("task5_%d", time.Now().UnixNano())
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
		t.Fatalf("ping isolated database: %v", err)
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

package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	appdb "github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/db"
)

func TestAirQualityLimit(t *testing.T) {
	tests := []struct {
		raw   string
		want  int
		valid bool
	}{
		{"", 50, true},
		{" ", 0, false},
		{"\t", 0, false},
		{"1", 1, true},
		{"50", 50, true},
		{"0", 0, false},
		{"51", 0, false},
		{"abc", 0, false},
	}

	for _, tc := range tests {
		got, valid := airQualityLimit(tc.raw)
		if got != tc.want || valid != tc.valid {
			t.Fatalf("airQualityLimit(%q) = (%d, %v), want (%d, %v)", tc.raw, got, valid, tc.want, tc.valid)
		}
	}
}

func TestAirQualityObservationsLatestOmitsRawPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
		WillReturnRows(sqlmock.NewRows([]string{"source_active"}).AddRow(true))
	mock.ExpectQuery("WITH latest AS").
		WithArgs("bmkg", 50).
		WillReturnRows(airQualityRows(now).AddRow(
			"obs-1", "bmkg", "kmy3", "Kemayoran", -6.155, 106.84,
			"pm25", 66.2, "ug/m3", "Tidak Sehat", now,
			"https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3", false, now.Add(time.Minute),
		))

	body := requestAirQuality(t, db, "/api/v1/air-quality/observations?source=bmkg&latest=true&limit=50")
	if body.Status != http.StatusOK {
		t.Fatalf("status=%d body=%s", body.Status, body.Raw)
	}
	if len(body.Data) != 1 || body.Data[0]["category"] != "Tidak Sehat" {
		t.Fatalf("unexpected data: %#v", body.Data)
	}
	if _, exists := body.Data[0]["raw_payload"]; exists {
		t.Fatal("raw_payload leaked")
	}
	if !body.Meta.SourceActive || body.Meta.Count != 1 || body.Meta.Limit != 50 || !body.Meta.Latest {
		t.Fatalf("unexpected meta: %#v", body.Meta)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAirQualityObservationsHistoryUsesHistoryQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
		WillReturnRows(sqlmock.NewRows([]string{"source_active"}).AddRow(false))
	mock.ExpectQuery(`(?s)\A\s*SELECT\s+o\.id\b.*ORDER BY\s+CASE\s+o\.category\b`).
		WithArgs("", 2).
		WillReturnRows(airQualityRows(now).AddRow(
			"obs-2", "bmkg", "kmy3", "Kemayoran", -6.155, 106.84,
			"pm25", 120.0, "ug/m3", "Sangat Tidak Sehat", now,
			"https://www.bmkg.go.id/kualitas-udara/pm25/pm25_kmy3", true, now,
		))

	body := requestAirQuality(t, db, "/api/v1/air-quality/observations?latest=false&limit=2")
	if body.Status != http.StatusOK {
		t.Fatalf("status=%d body=%s", body.Status, body.Raw)
	}
	if body.Meta.Latest || body.Meta.SourceActive || body.Meta.Limit != 2 || len(body.Data) != 1 {
		t.Fatalf("unexpected response: %#v", body)
	}
	if body.Data[0]["stale"] != true {
		t.Fatalf("stale=%#v, want true", body.Data[0]["stale"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAirQualityObservationsRejectsInvalidQueries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, rawURL := range []string{
		"/api/v1/air-quality/observations?source=other",
		"/api/v1/air-quality/observations?source=BMKG",
		"/api/v1/air-quality/observations?source=%20",
		"/api/v1/air-quality/observations?latest=maybe",
		"/api/v1/air-quality/observations?latest=1",
		"/api/v1/air-quality/observations?latest=%20",
		"/api/v1/air-quality/observations?limit=0",
		"/api/v1/air-quality/observations?limit=51",
		"/api/v1/air-quality/observations?limit=abc",
		"/api/v1/air-quality/observations?limit=%20",
		"/api/v1/air-quality/observations?source=bmkg&source=bmkg",
		"/api/v1/air-quality/observations?unknown=value",
		"/api/v1/air-quality/observations?limit=1;source=bmkg",
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		body := requestAirQuality(t, db, rawURL)
		if body.Status != http.StatusBadRequest {
			t.Fatalf("%s status=%d body=%s", rawURL, body.Status, body.Raw)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}

	t.Run("invalid percent escape", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()

		body := requestAirQualityRawQuery(t, db, "limit=%ZZ")
		if body.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", body.Status, body.Raw)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestAirQualityObservationsSerializesNullableSafeFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
		WillReturnRows(sqlmock.NewRows([]string{"source_active"}).AddRow(true))
	mock.ExpectQuery("WITH latest AS").
		WithArgs("", 50).
		WillReturnRows(airQualityRows(now).AddRow(
			"obs-null", "bmkg", "station-null", "Station Null", nil, nil,
			"pm25", 66.2, "ug/m3", "Tidak Sehat", now, nil, false, now,
		))

	body := requestAirQuality(t, db, "/api/v1/air-quality/observations")
	if body.Status != http.StatusOK || len(body.Data) != 1 {
		t.Fatalf("unexpected response: %#v", body)
	}
	for _, field := range []string{"latitude", "longitude", "source_url"} {
		if body.Data[0][field] != nil {
			t.Fatalf("%s=%#v, want JSON null", field, body.Data[0][field])
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAirQualityObservationsSourceStatusAbsentIsInactive(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("WITH latest AS").
		WithArgs("", 50).
		WillReturnRows(airQualityRows(time.Now()))

	body := requestAirQuality(t, db, "/api/v1/air-quality/observations")
	if body.Status != http.StatusOK || body.Meta.SourceActive || !body.Meta.Latest {
		t.Fatalf("unexpected response: %#v", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAirQualityObservationsHandlesDatabaseErrorsAndCancellation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name         string
		setup        func(sqlmock.Sqlmock)
		request      func() *http.Request
		wantError    string
		wantHTTPCode int
	}{
		{
			name: "source status query failure",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").WillReturnError(errors.New("status unavailable"))
			},
			request: func() *http.Request {
				return httptest.NewRequest(http.MethodGet, "/api/v1/air-quality/observations", nil)
			},
			wantError: "source_status_query_failed", wantHTTPCode: http.StatusServiceUnavailable,
		},
		{
			name: "observation query failure",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT enabled AND run_mode = 'active'").
					WillReturnRows(sqlmock.NewRows([]string{"source_active"}).AddRow(true))
				mock.ExpectQuery("WITH latest AS").WithArgs("", 50).WillReturnError(errors.New("query unavailable"))
			},
			request: func() *http.Request {
				return httptest.NewRequest(http.MethodGet, "/api/v1/air-quality/observations", nil)
			},
			wantError: "database_query_failed", wantHTTPCode: http.StatusServiceUnavailable,
		},
		{
			name:  "cancelled request",
			setup: func(sqlmock.Sqlmock) {},
			request: func() *http.Request {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return httptest.NewRequest(http.MethodGet, "/api/v1/air-quality/observations", nil).WithContext(ctx)
			},
			wantError: "request_cancelled", wantHTTPCode: http.StatusRequestTimeout,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			tc.setup(mock)

			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = tc.request()
			AirQualityObservations(db)(ctx)
			if recorder.Code != tc.wantHTTPCode {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			var response map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response["error"] != tc.wantError {
				t.Fatalf("error=%#v, want %q", response["error"], tc.wantError)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAirQualityQueriesAreDeterministicAndDoNotSelectRawPayload(t *testing.T) {
	for name, query := range map[string]string{
		"latest":  airQualityLatestQuery,
		"history": airQualityHistoryQuery,
	} {
		t.Run(name, func(t *testing.T) {
			if strings.Contains(strings.ToLower(query), "raw_payload") {
				t.Fatal("query must not select raw_payload")
			}
			for _, fragment := range []string{
				"CASE ", "WHEN 'Berbahaya' THEN 5", "observed_at DESC", "station_id ASC", "pollutant ASC", "id ASC",
			} {
				if !strings.Contains(query, fragment) {
					t.Fatalf("query missing deterministic ordering fragment %q", fragment)
				}
			}
		})
	}
}

func TestAirQualityObservationsPostgreSQL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openAirQualityPostgreSQL(t)
	if _, err := db.Exec(airQualityPostgreSQLSchema + airQualityPostgreSQLFixtures); err != nil {
		t.Fatalf("create fixture: %v", err)
	}

	latest := requestAirQuality(t, db, "/api/v1/air-quality/observations?latest=true&limit=50")
	if latest.Status != http.StatusOK {
		t.Fatalf("latest status=%d body=%s", latest.Status, latest.Raw)
	}
	if got, want := airQualityIDs(latest.Data), []string{"00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000002"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("latest ids=%v, want %v", got, want)
	}
	if latest.Data[0]["stale"] != true || latest.Data[1]["stale"] != false {
		t.Fatalf("unexpected stale values: %#v", latest.Data)
	}
	if _, exists := latest.Data[0]["raw_payload"]; exists {
		t.Fatal("raw_payload leaked")
	}
	if !latest.Meta.SourceActive {
		t.Fatalf("source_active=%v, want true", latest.Meta.SourceActive)
	}

	if _, err := db.Exec(`UPDATE official_source_settings SET enabled=FALSE WHERE source_name='bmkg_air_quality'`); err != nil {
		t.Fatalf("disable source: %v", err)
	}
	history := requestAirQuality(t, db, "/api/v1/air-quality/observations?latest=false&limit=3")
	if history.Status != http.StatusOK || history.Meta.SourceActive || history.Meta.Latest {
		t.Fatalf("unexpected history response: %#v", history)
	}
	if got, want := airQualityIDs(history.Data), []string{"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000002"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("history ids=%v, want %v", got, want)
	}

	if _, err := db.Exec(`DELETE FROM official_source_settings WHERE source_name='bmkg_air_quality'`); err != nil {
		t.Fatalf("delete source setting: %v", err)
	}
	missingSetting := requestAirQuality(t, db, "/api/v1/air-quality/observations?latest=true")
	if missingSetting.Status != http.StatusOK || missingSetting.Meta.SourceActive || !missingSetting.Meta.Latest || missingSetting.Meta.Count != 0 || len(missingSetting.Data) != 0 {
		t.Fatalf("unexpected missing-setting response: %#v", missingSetting)
	}
}

type airQualityResponse struct {
	Status int
	Raw    string
	Data   []map[string]any `json:"data"`
	Meta   struct {
		Count        int  `json:"count"`
		Limit        int  `json:"limit"`
		Latest       bool `json:"latest"`
		SourceActive bool `json:"source_active"`
	} `json:"meta"`
}

func airQualityRows(now time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "source", "station_id", "station_name", "latitude", "longitude",
		"pollutant", "value", "unit", "category", "observed_at", "source_url",
		"stale", "ingested_at",
	})
}

func requestAirQuality(t *testing.T, db *sql.DB, rawURL string) airQualityResponse {
	t.Helper()
	return requestAirQualityRequest(t, db, httptest.NewRequest(http.MethodGet, rawURL, nil))
}

func requestAirQualityRawQuery(t *testing.T, db *sql.DB, rawQuery string) airQualityResponse {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/air-quality/observations", nil)
	request.URL.RawQuery = rawQuery
	return requestAirQualityRequest(t, db, request)
}

func requestAirQualityRequest(t *testing.T, db *sql.DB, request *http.Request) airQualityResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = request
	AirQualityObservations(db)(ctx)
	response := airQualityResponse{Status: recorder.Code, Raw: recorder.Body.String()}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	return response
}

func airQualityIDs(data []map[string]any) []string {
	ids := make([]string, 0, len(data))
	for _, item := range data {
		ids = append(ids, item["id"].(string))
	}
	return ids
}

const airQualityPostgreSQLSchema = `
CREATE TABLE official_source_settings (
    source_name TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    run_mode TEXT NOT NULL,
    expected_interval_seconds INT NOT NULL
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
    raw_payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL
);
`

const airQualityPostgreSQLFixtures = `
INSERT INTO official_source_settings (source_name, enabled, run_mode, expected_interval_seconds)
VALUES ('bmkg_air_quality', TRUE, 'active', 1);

INSERT INTO air_quality_observations (
    id, source, station_id, station_name, latitude, longitude, pollutant, value,
    unit, category, observed_at, source_url, raw_payload, ingested_at
) VALUES
    ('00000000-0000-0000-0000-000000000001', 'bmkg', 'station-1', 'Station 1', -6.15, 106.85, 'pm25', 160, 'ug/m3', 'Berbahaya', now() - interval '5 seconds', 'https://www.bmkg.go.id/station-1', '{"secret":"old"}', now() - interval '5 seconds'),
    ('00000000-0000-0000-0000-000000000002', 'bmkg', 'station-1', 'Station 1', -6.15, 106.85, 'pm25', 66, 'ug/m3', 'Tidak Sehat', now(), 'https://www.bmkg.go.id/station-1', '{"secret":"latest"}', now()),
    ('00000000-0000-0000-0000-000000000003', 'bmkg', 'station-2', 'Station 2', -6.20, 106.90, 'pm25', 160, 'ug/m3', 'Berbahaya', now() - interval '5 seconds', 'https://www.bmkg.go.id/station-2', '{"secret":"stale"}', now() - interval '5 seconds');
`

func openAirQualityPostgreSQL(t *testing.T) *sql.DB {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL integration test")
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
	schema := fmt.Sprintf("task8_%d", time.Now().UnixNano())
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
		t.Fatalf("open scoped database: %v", err)
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
		admin.Close()
		t.Fatalf("ping scoped database: %v", err)
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

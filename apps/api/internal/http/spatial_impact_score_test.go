package http

import (
	"context"
	"database/sql"
	"errors"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/elevation"
)

func newImpactScoreTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/spatial/impact-score", SpatialImpactScore(db))
	return router
}

func TestSpatialImpactScoreExplainsComponents(t *testing.T) {
	// Samakan elevasi: sampler cepat-gagal agar test tak menunggu AWS.
	offline := elevation.NewSampler(1)
	offline.FetchTile = func(ctx context.Context, z, x, y int) (*elevation.TileImage, error) {
		return nil, errors.New("offline")
	}
	restoreSampler := setElevationSamplerForTest(offline)
	defer restoreSampler()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	eventTime := time.Now().Add(-2 * time.Hour)
	// Query event: id, event_type, magnitude, event_time, latitude, longitude.
	eventRows := sqlmock.NewRows([]string{"id", "event_type", "magnitude", "event_time", "latitude", "longitude"}).
		AddRow("uuid-1", "earthquake", 6.5, eventTime, -6.2, 106.8)
	mock.ExpectQuery(`FROM events`).WithArgs("bmkg:test-1", "test-1").WillReturnRows(eventRows)

	// Radius utk M6.5 = 50 km -> poligon & grid; populasi S1.
	mock.ExpectQuery(`FROM zonal_population_summary`).
		WillReturnRows(sqlmock.NewRows([]string{"population"}).AddRow(1_234_567.0))
	// Landcover S3: dua kelas.
	mock.ExpectQuery(`FROM zonal_landcover_summary`).
		WillReturnRows(sqlmock.NewRows([]string{"class_code", "fraction"}).
			AddRow(50, 0.6).
			AddRow(40, 0.2))
	// Elevasi S4: tile AWS — injeksi sampler palsu lewat package-level?
	// Handler memakai getElevationSampler() global; dalam test tanpa jaringan
	// query elevasi gagal senyap (komponen 0 + fallback) — cukup untuk
	// verifikasi explainability; akurasi elevasi diuji terpisah.
	// Fasilitas S2.
	mock.ExpectQuery(`FROM evacuation_locations`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(9))

	router := newImpactScoreTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/impact-score?event_id=bmkg:test-1", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data struct {
			Score       float64 `json:"score"`
			ScoreLabel  string  `json:"score_label"`
			RadiusKm    float64 `json:"radius_km"`
			Components  map[string]float64 `json:"components"`
			Fallbacks   map[string]bool   `json:"fallbacks"`
			Spatial     struct {
				Population         float64 `json:"population"`
				CriticalFacilities int     `json:"critical_facilities"`
			} `json:"spatial"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Data.RadiusKm != 50 {
		t.Fatalf("radius = %v, want 50 (M>=6)", payload.Data.RadiusKm)
	}
	if payload.Data.Spatial.Population != 1_234_567 {
		t.Fatalf("population = %v", payload.Data.Spatial.Population)
	}
	if payload.Data.Spatial.CriticalFacilities != 9 {
		t.Fatalf("facilities = %v", payload.Data.Spatial.CriticalFacilities)
	}
	// M6.5 Jakarta 1.2jt jiwa: skor major (>=55) dan terjelaskan.
	if payload.Data.Score < 55 || payload.Data.Score > 100 {
		t.Fatalf("score = %v (%s), want >= 55", payload.Data.Score, payload.Data.ScoreLabel)
	}
	if payload.Data.Components["exposure"] != 1.0 {
		t.Fatalf("exposure 1.2jt jiwa harus 1.0 (jenuh), dapat %v", payload.Data.Components["exposure"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSpatialImpactScoreValidationAndMissing(t *testing.T) {
	t.Run("missing event_id", func(t *testing.T) {
		db, _, _ := sqlmock.New()
		defer db.Close()
		router := newImpactScoreTestRouter(db)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/spatial/impact-score", nil))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status = %d", recorder.Code)
		}
	})
	t.Run("event not found", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectQuery(`FROM events`).WithArgs("nope", "nope").
			WillReturnRows(sqlmock.NewRows([]string{"id", "event_type", "magnitude", "event_time", "latitude", "longitude"}))
		router := newImpactScoreTestRouter(db)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/spatial/impact-score?event_id=nope", nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", recorder.Code)
		}
	})
}

func TestImpactRadiusPerPerilAndMagnitude(t *testing.T) {
	cases := []struct {
		peril  string
		mag    float64
		wantKm float64
	}{
		{"earthquake", 7.5, 80},
		{"earthquake", 6.2, 50},
		{"earthquake", 4.0, 30},
		{"tsunami", 0, 100},
		{"flood", 3, 25},
		{"volcano", 2, 40},
		{"wildfire", 5, 20},
		{"unknown", 5, 30},
	}
	for _, tc := range cases {
		if got := impactRadiusKm(tc.peril, tc.mag); got != tc.wantKm {
			t.Fatalf("radius(%s,%.1f) = %v, want %v", tc.peril, tc.mag, got, tc.wantKm)
		}
	}
}

func TestImpactLabelBands(t *testing.T) {
	bands := []struct {
		score float64
		want  string
	}{{80, "catastrophic"}, {60, "major"}, {40, "moderate"}, {20, "minor"}, {5, "negligible"}}
	for _, b := range bands {
		if got := impactLabel(b.score); got != b.want {
			t.Fatalf("label(%v) = %s, want %s", b.score, got, b.want)
		}
	}
}

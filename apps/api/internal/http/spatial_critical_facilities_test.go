package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func newCriticalFacilitiesRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/spatial/critical-facilities", CriticalFacilitiesSummary(db))
	return router
}

func TestCriticalFacilitiesSummaryAggregatesByType(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	// Dua rumah sakit dekat + satu damkar jauh (di luar radius 10 km).
	rows := sqlmock.NewRows([]string{"id", "name", "location_type", "latitude", "longitude"}).
		AddRow("id-1", "RS Jakarta", "rumah_sakit", -6.20, 106.81).
		AddRow("id-2", "RS Harapan", "rumah_sakit", -6.25, 106.85).
		AddRow("id-3", "Damkar Bogor", "damkar", -6.60, 106.80)
	// Origin (-6.2, 106.8): RS ±1.1 km & ±5.7 km; damkar ±44 km (di luar 10).
	mock.ExpectQuery(`FROM evacuation_locations`).
		WillReturnRows(rows)

	router := newCriticalFacilitiesRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/critical-facilities?lat=-6.2&lon=106.8&radius_km=10", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data struct {
			Total   int            `json:"total"`
			Counts  map[string]int `json:"counts"`
			Facilities []struct {
				Name       string  `json:"name"`
				DistanceKm float64 `json:"distance_km"`
			} `json:"facilities"`
			Attribution string `json:"attribution"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Data.Total != 2 {
		t.Fatalf("total = %d, want 2 (damkar di luar radius)", payload.Data.Total)
	}
	if payload.Data.Counts["rumah_sakit"] != 2 || payload.Data.Counts["damkar"] != 0 {
		t.Fatalf("counts = %v", payload.Data.Counts)
	}
	if payload.Data.Attribution != "OpenStreetMap contributors" {
		t.Fatalf("attribution = %q", payload.Data.Attribution)
	}
	for _, f := range payload.Data.Facilities {
		if f.DistanceKm > 10 {
			t.Fatalf("facility %s distance %.2f melebihi radius", f.Name, f.DistanceKm)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCriticalFacilitiesSummaryValidation(t *testing.T) {
	cases := []struct {
		name   string
		query  string
		want   int
	}{
		{"missing coords", "", http.StatusBadRequest},
		{"lat out of range", "lat=-95&lon=106", http.StatusBadRequest},
		{"bad radius zero", "lat=-6&lon=106&radius_km=0", http.StatusBadRequest},
		{"bad radius too large", "lat=-6&lon=106&radius_km=500", http.StatusBadRequest},
		{"unknown type", "lat=-6&lon=106&types=rumah_sakit,mall", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, _, _ := sqlmock.New()
			defer db.Close()
			router := newCriticalFacilitiesRouter(db)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/critical-facilities?"+tc.query, nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.want)
			}
		})
	}
}

func TestCriticalFacilitiesSummaryTypeFilter(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	rows := sqlmock.NewRows([]string{"id", "name", "location_type", "latitude", "longitude"}).
		AddRow("id-1", "RS Jakarta", "rumah_sakit", -6.20, 106.81).
		AddRow("id-2", "Polsek", "kantor_polisi", -6.21, 106.80)
	mock.ExpectQuery(`FROM evacuation_locations`).WillReturnRows(rows)

	router := newCriticalFacilitiesRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/critical-facilities?lat=-6.2&lon=106.8&radius_km=10&types=kantor_polisi", nil)
	router.ServeHTTP(recorder, request)

	var payload struct {
		Data struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Data.Total != 1 {
		t.Fatalf("total = %d, want 1 (filter kantor_polisi)", payload.Data.Total)
	}
}

func TestCriticalFacilitiesSummaryDatabaseFailure(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`FROM evacuation_locations`).WillReturnError(sql.ErrNoRows)

	router := newCriticalFacilitiesRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/critical-facilities?lat=-6.2&lon=106.8", nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
}

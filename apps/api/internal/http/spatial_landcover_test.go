package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func newLandcoverTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/spatial/landcover-summary", SpatialLandcoverSummary(db))
	return router
}

func TestSpatialLandcoverSummaryReturnsClassDistribution(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	polygon := "POLYGON((106.69 -6.37, 107.01 -6.37, 107.01 -6.08, 106.69 -6.08, 106.69 -6.37))"
	mock.ExpectQuery(`SELECT class_code, sample_count, fraction FROM zonal_landcover_summary`).
		WithArgs(polygon).
		WillReturnRows(sqlmock.NewRows([]string{"class_code", "sample_count", "fraction"}).
			AddRow(50, 420, 0.62).
			AddRow(10, 150, 0.22).
			AddRow(80, 107, 0.16))
	ingested := time.Date(2026, 8, 20, 8, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`FROM spatial_datasets`).
		WillReturnRows(sqlmock.NewRows([]string{"vintage", "attribution", "resolution_m", "ingested_at", "feature_count"}).
			AddRow("2020", "ESA WorldCover 10m 2020 v100 (CC BY 4.0)", 1030, ingested, 2500000))

	router := newLandcoverTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/landcover-summary?polygon="+url.QueryEscape(polygon), nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data struct {
			TotalSamples int64 `json:"total_samples"`
			Classes      []struct {
				ClassCode int     `json:"class_code"`
				Class     string  `json:"class"`
				Fraction  float64 `json:"fraction"`
			} `json:"classes"`
			Dataset struct {
				Vintage   string `json:"vintage"`
				Attribute string `json:"attribution"`
			} `json:"dataset"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Data.TotalSamples != 677 {
		t.Fatalf("total_samples = %d, want 677", payload.Data.TotalSamples)
	}
	if len(payload.Data.Classes) != 3 {
		t.Fatalf("classes = %+v", payload.Data.Classes)
	}
	if payload.Data.Classes[0].Class != "built_up" || payload.Data.Classes[0].ClassCode != 50 {
		t.Fatalf("class[0] = %+v, want built_up/50", payload.Data.Classes[0])
	}
	if payload.Data.Dataset.Vintage != "2020" {
		t.Fatalf("vintage = %q", payload.Data.Dataset.Vintage)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSpatialLandcoverSummaryValidation(t *testing.T) {
	cases := []struct{ name, polygon string; want int }{
		{"missing", "", http.StatusBadRequest},
		{"not polygon", "LINESTRING(1 2, 3 4)", http.StatusBadRequest},
		{"too large", "POLYGON((90 -20, 150 -20, 150 10, 90 10, 90 -20))", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, _, _ := sqlmock.New()
			defer db.Close()
			router := newLandcoverTestRouter(db)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/landcover-summary?polygon="+url.QueryEscape(tc.polygon), nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.want)
			}
		})
	}
}

func TestSpatialLandcoverSummaryUnknownClassLabel(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	polygon := "POLYGON((106 -6, 107 -6, 107 -5, 106 -5, 106 -6))"
	mock.ExpectQuery(`FROM zonal_landcover_summary`).WillReturnRows(
		sqlmock.NewRows([]string{"class_code", "sample_count", "fraction"}).AddRow(42, 3, 1.0))
	mock.ExpectQuery(`FROM spatial_datasets`).WillReturnError(sql.ErrNoRows)

	router := newLandcoverTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/landcover-summary?polygon="+url.QueryEscape(polygon), nil)
	router.ServeHTTP(recorder, request)

	var payload struct {
		Data struct {
			Classes []struct {
				Class string `json:"class"`
			} `json:"classes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(payload.Data.Classes) != 1 || payload.Data.Classes[0].Class != "other" {
		t.Fatalf("classes = %+v, want single other", payload.Data.Classes)
	}
}

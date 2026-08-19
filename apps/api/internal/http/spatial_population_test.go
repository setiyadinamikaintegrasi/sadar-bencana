package http

import (
	"database/sql"
	"fmt"
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func newSpatialTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/spatial/population-summary", SpatialPopulationSummary(db))
	return router
}

const jakartaPolygon = "POLYGON((106.69 -6.37, 107.01 -6.37, 107.01 -6.08, 106.69 -6.08, 106.69 -6.37))"

func TestSpatialPopulationSummaryReturnsZonalSum(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT population, cells FROM zonal_population_summary`).
		WithArgs(jakartaPolygon).
		WillReturnRows(sqlmock.NewRows([]string{"population", "cells"}).AddRow(15057772.4, 1242))
	ingested := time.Date(2026, 8, 20, 4, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`FROM spatial_datasets`).
		WillReturnRows(sqlmock.NewRows([]string{"dataset", "vintage", "resolution_m", "attribution", "ingested_at", "feature_count"}).
			AddRow("worldpop_population", "2020", 1000, "WorldPop (CC BY 4.0)", ingested, 2270281))

	router := newSpatialTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/population-summary?polygon="+urlEncode(t, jakartaPolygon), nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data struct {
			Population float64 `json:"population"`
			Cells      int64   `json:"cells"`
			Dataset    struct {
				Vintage     string `json:"vintage"`
				Attribution string `json:"attribution"`
			} `json:"dataset"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Data.Population != 15057772.4 || payload.Data.Cells != 1242 {
		t.Fatalf("summary = %+v", payload.Data)
	}
	if payload.Data.Dataset.Vintage != "2020" || payload.Data.Dataset.Attribution != "WorldPop (CC BY 4.0)" {
		t.Fatalf("dataset = %+v", payload.Data.Dataset)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSpatialPopulationSummaryValidation(t *testing.T) {
	cases := []struct {
		name    string
		polygon string
		want    int
	}{
		{"missing", "", http.StatusBadRequest},
		{"not-a-polygon", "POINT(1 2)", http.StatusBadRequest},
		{"unclosed ring", "POLYGON((106 -6, 107 -6, 107 -5, 106 -5))", http.StatusBadRequest},
		{"with hole rejected", "POLYGON((106 -6, 107 -6, 107 -5, 106 -5, 106 -6),(106.5 -5.5, 106.6 -5.5, 106.6 -5.4, 106.5 -5.5))", http.StatusBadRequest},
		{"too few vertices", "POLYGON((106 -6, 107 -6, 106 -6))", http.StatusBadRequest},
		{"out of range", "POLYGON((106 -96, 107 -96, 107 -5, 106 -5, 106 -96))", http.StatusBadRequest},
		{"too large", "POLYGON((95 -11, 141 -11, 141 6, 95 6, 95 -11))", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, _, _ := sqlmock.New()
			defer db.Close()
			router := newSpatialTestRouter(db)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/population-summary?polygon="+urlEncode(t, tc.polygon), nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d (%s), want %d", recorder.Code, recorder.Body.String(), tc.want)
			}
		})
	}
}

func TestParseWKTPolygonVertexLimit(t *testing.T) {
	// Polygon luar biasa (box) dengan ring tertutup, lalu sisipkan lebih
	// dari kuota vertex di sepanjang tepi bawah.
	var sb strings.Builder
	sb.WriteString("POLYGON((106.0 -6.0")
	for i := 1; i <= spatialPopulationMaxVertices; i++ {
		sb.WriteString(", ")
		sb.WriteString(fmt.Sprintf("%.4f -6.0", 106.0+float64(i)*0.001))
	}
	sb.WriteString(", 107.0 -5.0, 106.0 -5.0, 106.0 -6.0))")
	if _, ok := parseWKTPolygon(sb.String()); ok {
		t.Fatalf("polygon exceeding %d vertices should be rejected", spatialPopulationMaxVertices)
	}
}

func TestSpatialPopulationSummaryDatabaseFailure(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`SELECT population, cells FROM zonal_population_summary`).
		WithArgs(jakartaPolygon).
		WillReturnError(driver.ErrBadConn)

	router := newSpatialTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/population-summary?polygon="+urlEncode(t, jakartaPolygon), nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
}

func urlEncode(t *testing.T, value string) string {
	t.Helper()
	return url.QueryEscape(value)
}

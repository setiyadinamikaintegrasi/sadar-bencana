package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func newShakemapsTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/map/operations/shakemaps", OperationMapShakemaps(db))
	return router
}

func TestOperationMapShakemapsServesGeoreferencedOverlay(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{
		"event_id", "shakemap_key", "image_url", "magnitude", "depth_km",
		"latitude", "longitude", "min_longitude", "min_latitude", "max_longitude", "max_latitude",
		"felt_reports", "place", "fetched_at",
	}).AddRow(
		"bmkg:abc123", "20260820062013", "https://data.bmkg.go.id/DataMKG/TEWS/20260820062013.mmi.jpg",
		5.6, 10.0, -8.28, 120.57, 118.07, -10.78, 123.07, -5.78,
		"II Kab. Manggarai", "39 km utara Ruteng", time.Now(),
	)
	mock.ExpectQuery(`FROM shakemap_overlays`).WillReturnRows(rows)

	router := newShakemapsTestRouter(db)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/shakemaps?bbox=117,-11,124,-5&zoom=7", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var collection struct {
		Type     string `json:"type"`
		Layer    string `json:"layer"`
		Features []struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				ShakemapURL  string      `json:"shakemap_url"`
				ShakemapBBox *[4]float64 `json:"shakemap_bbox"`
				FeltReports  string      `json:"felt_reports"`
				EventID      string      `json:"event_id"`
				Layer        string      `json:"layer"`
				ObservedAt   *time.Time  `json:"observed_at"`
				Source       string      `json:"source"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &collection); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if collection.Layer != "shakemaps" || len(collection.Features) != 1 {
		t.Fatalf("collection = %s %+v", collection.Layer, collection.Features)
	}
	feature := collection.Features[0]
	if feature.Properties.ShakemapURL == "" || feature.Properties.ShakemapBBox == nil {
		t.Fatalf("georeferensi hilang: %+v", feature.Properties)
	}
	bbox := *feature.Properties.ShakemapBBox
	// Bbox 5° berpusat episenter: 120.57±2.5, -8.28±2.5.
	if bbox[0] != 118.07 || bbox[2] != 123.07 || bbox[1] != -10.78 || bbox[3] != -5.78 {
		t.Fatalf("bbox = %v", bbox)
	}
	if feature.Properties.EventID != "bmkg:abc123" || feature.Properties.FeltReports != "II Kab. Manggarai" {
		t.Fatalf("props = %+v", feature.Properties)
	}
	if feature.Properties.ObservedAt == nil {
		t.Fatal("observed_at wajib ada (deteksi auto-enable shakemap fresh)")
	}
	if feature.Geometry.Coordinates[0] != 120.57 || feature.Geometry.Coordinates[1] != -8.28 {
		t.Fatalf("episenter = %v", feature.Geometry.Coordinates)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestOperationMapShakemapsInvalidQuery(t *testing.T) {
	db, _, _ := sqlmock.New()
	defer db.Close()
	router := newShakemapsTestRouter(db)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/shakemaps?bbox=bogus", nil))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestOperationMapShakemapsDatabaseFailure(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`FROM shakemap_overlays`).WillReturnError(sql.ErrConnDone)
	router := newShakemapsTestRouter(db)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/shakemaps?bbox=117,-11,124,-5&zoom=7", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
}

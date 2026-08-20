package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func newElevationTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/spatial/elevation-summary", SpatialElevationSummary())
	return router
}

func TestSpatialElevationSummaryValidation(t *testing.T) {
	cases := []struct {
		name   string
		query  string
		want   int
	}{
		{"missing all", "", http.StatusBadRequest},
		{"partial bbox", "min_lng=106&min_lat=-6&max_lng=107", http.StatusBadRequest},
		{"inverted", "min_lng=107&min_lat=-6&max_lng=106&max_lat=-5", http.StatusBadRequest},
		{"out of range", "min_lng=-999&min_lat=-6&max_lng=107&max_lat=-5", http.StatusBadRequest},
		{"too large", "min_lng=95&min_lat=-11&max_lng=141&max_lat=6", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			router := newElevationTestRouter()
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/elevation-summary?"+tc.query, nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d (%s), want %d", recorder.Code, recorder.Body.String(), tc.want)
			}
		})
	}
}

// TestSpatialElevationSummaryValidation hanya memastikan jalur validasi;
// jalur sukses membutuhkan tile AWS — diverifikasi di dev lewat smoke test
// live (lihat commit message) dan tidak bisa dimock di handler tanpa injeksi.
func TestSpatialElevationSummaryRouterRegistered(t *testing.T) {
	db, _, _ := sqlmock.New()
	defer db.Close()
	router := newElevationTestRouter()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/spatial/elevation-summary", nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bbox wajib)", recorder.Code)
	}
}

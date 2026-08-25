package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func cctvCamerasRequest(path string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	return rec
}

func TestCctvCamerasListValidatesBbox(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	handler := CctvCamerasGeoJSON(db)
	rec := cctvCamerasRequest("/")
	c, _ := gin.CreateTestContext(rec)
	// bbox tidak valid: min > max
	req := httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/cctv?bbox=107.0,-6.0,106.0,-6.5", nil)
	c.Request = req
	handler(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bbox invalid)", rec.Code)
	}
}

func TestCctvCamerasListMissingBbox(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	handler := CctvCamerasGeoJSON(db)
	rec := cctvCamerasRequest("/")
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/cctv", nil)
	c.Request = req
	handler(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bbox missing)", rec.Code)
	}
}

func TestCctvCamerasGeoJSONOutput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{
		"camera_id", "toll_road_name", "segment_name", "km_point",
		"operator_code", "operator_name", "latitude", "longitude",
		"stream_url", "stream_protocol", "is_online",
	}).
		AddRow("479-1-105", "Jakarta-Bogor-Ciawi", "CILILITAN - TM MINI",
			"JAGORAWI KM 04+500 | B", "jm", "PT Jasa Marga (Persero) Tbk",
			-6.2856471909535, 106.877086758614,
			"https://jid.jasamarga.com/cctv2/abc?tx=1", "m3u8", true)

	mock.ExpectQuery("SELECT camera_id").WillReturnRows(rows)

	handler := CctvCamerasGeoJSON(db)
	rec := cctvCamerasRequest("/")
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/map/operations/cctv?bbox=106.0,-7.0,107.0,-6.0", nil)
	c.Request = req
	handler(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Type     string `json:"type"`
		Features []struct {
			ID         string `json:"id"`
			Properties struct {
				TollRoad string `json:"toll_road"`
				KM       string `json:"km"`
				Operator string `json:"operator"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body.Type != "FeatureCollection" {
		t.Fatalf("type = %s, want FeatureCollection", body.Type)
	}
	if len(body.Features) != 1 {
		t.Fatalf("features = %d, want 1", len(body.Features))
	}
	f := body.Features[0]
	if f.ID != "479-1-105" {
		t.Fatalf("id = %s, want 479-1-105", f.ID)
	}
	if f.Properties.TollRoad != "Jakarta-Bogor-Ciawi" {
		t.Fatalf("toll_road = %s", f.Properties.TollRoad)
	}
}

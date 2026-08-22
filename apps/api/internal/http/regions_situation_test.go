package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

var testTime = time.Date(2026, 8, 21, 6, 0, 0, 0, time.UTC)

func httptestRecorder() *httptest.ResponseRecorder { return httptest.NewRecorder() }

func httptestRequest(method, target string) *http.Request {
	return httptest.NewRequest(method, target, nil)
}

func decodeJSON(b []byte, v any) error { return json.Unmarshal(b, v) }

func TestRegionDefinitionsCoverIndonesia(t *testing.T) {
	if len(regionDefinitions) != 8 {
		t.Fatalf("jumlah wilayah = %d, want 8", len(regionDefinitions))
	}
	seen := map[string]bool{}
	for _, r := range regionDefinitions {
		if seen[r.Code] {
			t.Fatalf("kode wilayah duplikat: %s", r.Code)
		}
		seen[r.Code] = true
		if r.MinLon >= r.MaxLon || r.MinLat >= r.MaxLat {
			t.Fatalf("bbox tidak valid utk %s", r.Code)
		}
	}
	for _, code := range []string{"kalimantan", "ntt", "sumatera", "jawa"} {
		if !seen[code] {
			t.Fatalf("wilayah kunci hilang: %s", code)
		}
	}
}

func TestRegionCaseSQLValid(t *testing.T) {
	sql := regionCaseSQL()
	if sql == "" || sql[:4] != "CASE" {
		t.Fatalf("CASE SQL tidak valid: %.40s", sql)
	}
	// harus memuat semua kode wilayah
	for _, r := range regionDefinitions {
		if !contains(sql, "'"+r.Code+"'") {
			t.Fatalf("SQL tidak memuat wilayah %s", r.Code)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func TestRegionsSituationDatabaseUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := RegionsSituation(nil)
	rec := httptestRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptestRequest("GET", "/")
	handler(c)
	if rec.Code != 503 {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestRegionsSituationReturnsAllRegions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	// peril rows
	perilRows := sqlmock.NewRows([]string{"region", "event_type", "count_72h", "count_today", "max_magnitude", "latest_at", "first_at"}).
		AddRow("kalimantan", "wildfire", 782, 76, 0.0, testTime, testTime).
		AddRow("ntt", "earthquake", 68, 5, 5.8, testTime, testTime)
	mock.ExpectQuery("WITH tagged").WillReturnRows(perilRows)

	// places rows
	placeRows := sqlmock.NewRows([]string{"region", "place_key", "count"}).
		AddRow("kalimantan", "Sintang", 40).
		AddRow("kalimantan", "Ketapang", 31).
		AddRow("ntt", "NTT", 22)
	mock.ExpectQuery("WITH tagged").WillReturnRows(placeRows)

	// news rows (per wilayah = 8 kali)
	for range 8 {
		mock.ExpectQuery("SELECT count").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))
	}

	handler := RegionsSituation(db)
	rec := httptestRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptestRequest("GET", "/")
	handler(c)

	if rec.Code != 200 {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Regions []RegionSituation `json:"regions"`
	}
	if err := decodeJSON(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Regions) != 8 {
		t.Fatalf("jumlah wilayah = %d, want 8", len(body.Regions))
	}
	byCode := map[string]RegionSituation{}
	for _, r := range body.Regions {
		byCode[r.Code] = r
	}
	kal := byCode["kalimantan"]
	if len(kal.Perils) != 1 || kal.Perils[0].Count72h != 782 {
		t.Fatalf("kalimantan perils = %+v", kal.Perils)
	}
	if len(kal.TopPlaces) < 2 || kal.TopPlaces[0] != "Sintang" {
		t.Fatalf("kalimantan places = %+v", kal.TopPlaces)
	}
	if kal.SeverityIndex <= 0 {
		t.Fatalf("kalimantan severity = %d, want > 0", kal.SeverityIndex)
	}
	ntt := byCode["ntt"]
	if ntt.Perils[0].MaxMagnitude != 5.8 {
		t.Fatalf("ntt max magnitude = %v", ntt.Perils[0].MaxMagnitude)
	}
	// NTT dgn M5.8 (>=5) dapat bonus severity
	if ntt.SeverityIndex < 15 {
		t.Fatalf("ntt severity = %d, want >= 15 (share+bonus)", ntt.SeverityIndex)
	}
	// wilayah tanpa event tetap ada dengan array kosong
	empty := byCode["papua"]
	if empty.TotalEvents != 0 || empty.Perils == nil {
		t.Fatalf("papua seharusnya kosong: %+v", empty)
	}
}

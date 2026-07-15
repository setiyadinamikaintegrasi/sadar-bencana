package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestOfficialOverlayQueryHidesInactiveSourceAndFutureWarnings(t *testing.T) {
	for _, clause := range []string{
		"JOIN official_source_settings s ON s.source_name = oa.source",
		"s.enabled = TRUE",
		"s.run_mode = 'active'",
		"oa.effective_at IS NULL OR oa.effective_at <= now()",
	} {
		if !strings.Contains(officialOverlayQuery, clause) {
			t.Fatalf("official overlay query missing active-warning guard %q", clause)
		}
	}
}

func TestMapOverlaysReturnsBMKGMetadataForCoordinateAlert(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Now()
	mock.ExpectQuery("FROM official_alerts").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "headline", "area_geojson", "latitude", "longitude", "effective_at",
			"expires_at", "source", "peril_type", "source_url",
		}).AddRow(
			"alert-1", "Peringatan Dini Cuaca", nil, -6.2, 106.8, now,
			now.Add(time.Hour), "bmkg_cap", "weather",
			"https://www.bmkg.go.id/alerts/alert-1",
		))
	mock.ExpectQuery("FROM risk_context").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "peril_type", "context_key", "area_geojson", "data_vintage", "attribution", "source_url",
		}))

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/map/overlays", nil)
	MapRiskOverlays(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	item := body["data"].([]any)[0].(map[string]any)
	if item["peril_type"] != "weather" || item["source_url"] != "https://www.bmkg.go.id/alerts/alert-1" ||
		item["latitude"] != -6.2 || item["longitude"] != 106.8 ||
		item["attribution"] != "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)" {
		t.Fatalf("missing official overlay metadata: %#v", item)
	}
	if _, exists := item["raw_payload"]; exists {
		t.Fatal("raw_payload leaked")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

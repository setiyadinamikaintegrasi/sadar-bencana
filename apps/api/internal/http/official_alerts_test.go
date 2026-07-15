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

func TestOfficialAlertsQueryHidesInactiveSourceAndFutureActiveWarnings(t *testing.T) {
	for _, clause := range []string{
		"s.source_name = official_alerts.source",
		"s.enabled = TRUE",
		"s.run_mode = 'active'",
		"effective_at IS NULL OR effective_at <= now()",
	} {
		if !strings.Contains(officialAlertsQuery, clause) {
			t.Fatalf("official alerts query missing active-warning guard %q", clause)
		}
	}
}

func TestOfficialAlertLimit(t *testing.T) {
	tests := []struct {
		raw   string
		want  int
		valid bool
	}{
		{"", 100, true},
		{"1", 1, true},
		{"200", 200, true},
		{"0", 0, false},
		{"201", 0, false},
		{"invalid", 0, false},
	}

	for _, tc := range tests {
		got, valid := officialAlertLimit(tc.raw)
		if got != tc.want || valid != tc.valid {
			t.Fatalf("officialAlertLimit(%q) = (%d, %v), want (%d, %v)",
				tc.raw, got, valid, tc.want, tc.valid)
		}
	}
}

func TestOfficialAlertStatuses(t *testing.T) {
	for _, status := range []string{"active", "updated", "expired", "cancelled"} {
		if !officialAlertStatuses[status] {
			t.Fatalf("expected %q to be accepted", status)
		}
	}
	if officialAlertStatuses["unknown"] {
		t.Fatal("unknown status must be rejected")
	}
}

func TestOfficialAlertPerilTypes(t *testing.T) {
	for _, peril := range []string{"weather", "air_quality"} {
		if !officialAlertPerilTypes[peril] {
			t.Fatalf("expected %q to be accepted", peril)
		}
	}
	if officialAlertPerilTypes["earthquake"] {
		t.Fatal("unsupported peril accepted")
	}
}

func TestOfficialAlertsRejectsUnsupportedPerilType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet,
		"/api/v1/official-alerts?peril_type=earthquake", nil)

	OfficialAlerts(db)(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "invalid_peril_type" {
		t.Fatalf("error = %#v, want invalid_peril_type", body["error"])
	}
}

func TestOfficialAlertsReturnsStructuredMetadataWithoutRawPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Now()
	columns := []string{
		"id", "source", "source_alert_id", "revision", "message_type", "status",
		"sent_at", "effective_at", "expires_at", "headline", "description",
		"area_geojson", "previous_alert_id", "is_current", "ingested_at",
		"peril_type", "severity", "category", "area_name", "latitude",
		"longitude", "source_url",
	}
	mock.ExpectQuery("FROM official_alerts").
		WithArgs("", "", false, "weather", 100).
		WillReturnRows(sqlmock.NewRows(columns).AddRow(
			"alert-1", "bmkg_cap", "cap-1", 1, "alert", "active", now,
			now, now.Add(time.Hour), "Peringatan Dini Cuaca", "Hujan lebat",
			[]byte(`{"type":"Polygon","coordinates":[]}`), nil, true, now,
			"weather", "High", nil, "Jawa Barat", nil, nil,
			"https://www.bmkg.go.id/alerts/alert-1",
		))

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet,
		"/api/v1/official-alerts?peril_type=weather", nil)
	OfficialAlerts(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	item := body["data"].([]any)[0].(map[string]any)
	if item["peril_type"] != "weather" || item["severity"] != "High" ||
		item["area_name"] != "Jawa Barat" {
		t.Fatalf("missing metadata: %#v", item)
	}
	if _, exists := item["raw_payload"]; exists {
		t.Fatal("raw_payload leaked")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestPersonalAssetRiskFiltersNonProductionRowsBeforeLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT latitude,longitude,alert_radius_km,array_to_string\(peril_types,','\).*FROM personal_assets`).
		WithArgs("asset-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"latitude", "longitude", "alert_radius_km", "perils"}).
			AddRow(-6.2, 106.8, 100.0, "earthquake,wildfire,flood"))

	eventRows := sqlmock.NewRows([]string{
		"event_id", "event_type", "place", "magnitude", "severity", "event_time",
		"source", "score", "latitude", "longitude", "has_alert",
	}).
		AddRow("synthetic:asset:1", "earthquake", "Tagged ID", 6.0, "critical", "2026-07-15T10:00:00+00", "bmkg", 99.0, -6.2, 106.8, true).
		AddRow("bmkg:tagged-source", "earthquake", "Tagged source", 6.0, "critical", "2026-07-15T09:00:00+00", "test-data", 98.0, -6.2, 106.8, true).
		AddRow("bmkg:20260715:1", "earthquake", "Jakarta", 5.8, "high", "2026-07-15T08:00:00+00", "bmkg", 90.0, -6.2, 106.8, true).
		AddRow("us7000real", "earthquake", "Papua", 5.4, "high", "2026-07-15T07:00:00+00", "usgs", 80.0, -6.2, 106.8, false).
		AddRow("firms:20260715:1", "wildfire", "Kalimantan", 0.0, "medium", "2026-07-15T06:00:00+00", "nasa-firms", 70.0, -6.2, 106.8, false).
		AddRow("contest:historical:1", "flood", "Legacy", 2.0, "low", "2026-07-15T05:00:00+00", "legacy-import", 60.0, -6.2, 106.8, false)

	mock.ExpectQuery(`(?s)FROM events e.*WHERE e\.latitude.*regexp_replace.*e\.source.*regexp_replace.*e\.event_id.*ORDER BY e\.event_time DESC LIMIT 200`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(eventRows)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(ctxAuthUserID, "user-1")
	context.Params = gin.Params{{Key: "id", Value: "asset-1"}}
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/personal-assets/asset-1/risk", nil)

	PersonalAssetRisk(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			NearbyEvents     []personalRiskEvent `json:"nearby_events"`
			NearbyEventCount int                 `json:"nearby_event_count"`
			ActiveAlertCount int                 `json:"active_alert_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.NearbyEventCount != 4 || len(response.Data.NearbyEvents) != 4 {
		t.Fatalf("expected 4 production nearby events, got count=%d rows=%d", response.Data.NearbyEventCount, len(response.Data.NearbyEvents))
	}
	if response.Data.ActiveAlertCount != 1 {
		t.Fatalf("active alert count = %d, want 1", response.Data.ActiveAlertCount)
	}
	want := []string{"bmkg:20260715:1", "us7000real", "firms:20260715:1", "contest:historical:1"}
	for i, eventID := range want {
		if response.Data.NearbyEvents[i].EventID != eventID {
			t.Fatalf("row %d event_id = %q, want %q", i, response.Data.NearbyEvents[i].EventID, eventID)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

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

func TestEventsQueryFiltersNonProductionMarkersBeforeCategoryLimits(t *testing.T) {
	if !strings.Contains(eventsQuery, "WITH production_events AS") {
		t.Fatal("events query must filter non-production rows before category limits")
	}
	if got := strings.Count(eventsQuery, "FROM production_events"); got != 4 {
		t.Fatalf("events query must apply the filtered relation to all four categories; got %d", got)
	}
	for _, marker := range []string{"seed", "demo", "synthetic", "mock", "fixture", "test"} {
		if !strings.Contains(eventsQuery, marker) {
			t.Fatalf("events query is missing non-production marker %q", marker)
		}
	}
}

func TestEventsExcludesNonProductionRowsAcrossCategories(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 7, 15, 10, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"id", "event_id", "source", "event_type", "magnitude", "latitude",
		"longitude", "place", "event_time", "url", "severity", "created_at",
	})
	addRow := func(id, eventID, source, eventType string) {
		rows.AddRow(id, eventID, source, eventType, 5.1, -6.2, 106.8, id, now, "https://example.test/event", nil, now)
	}
	addRow("synthetic-earthquake", "bmkg:real-looking", "seed-bmkg", "earthquake")
	addRow("synthetic-wildfire", "demo:nasa-firms:1", "nasa-firms", "wildfire")
	addRow("synthetic-flood", "legacy:1", "synthetic", "flood")
	addRow("synthetic-volcano", "fixture:gvp:1", "gvp", "volcano")
	addRow("synthetic-mock", "legacy:mock:1", "legacy-import", "flood")
	addRow("synthetic-test", "legacy:2", "test-data", "volcano")
	addRow("official-bmkg", "bmkg:20260715:1", "bmkg", "earthquake")
	addRow("official-usgs", "us7000real", "usgs", "earthquake")
	addRow("official-firms", "firms:20260715:1", "nasa-firms", "wildfire")
	addRow("legacy", "contest:historical:1", "legacy-import", "flood")

	mock.ExpectQuery("(?s).*FROM events.*").WillReturnRows(rows)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)

	Events(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data []Event `json:"data"`
		Meta struct {
			Count int `json:"count"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Meta.Count != 4 || len(response.Data) != 4 {
		t.Fatalf("expected 4 production events, got count=%d rows=%d", response.Meta.Count, len(response.Data))
	}
	for _, event := range response.Data {
		if strings.HasPrefix(event.ID, "synthetic-") {
			t.Fatalf("non-production event leaked into API response: %+v", event)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

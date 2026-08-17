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

func TestRiskScoresFiltersNonProductionRowsBeforeLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 7, 15, 10, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"entity_id", "score", "factors", "calculated_at", "place", "magnitude", "source",
	}).
		AddRow("synthetic:orphan:1", 99.0, []byte(`{"severity":"critical"}`), now, nil, nil, nil).
		AddRow("bmkg:tagged-source", 98.0, []byte(`{"severity":"critical"}`), now, "Tagged", 6.0, "demo-bmkg").
		AddRow("bmkg:20260715:1", 90.0, []byte(`{"severity":"high"}`), now, "Jakarta", 5.8, "bmkg").
		AddRow("us7000real", 80.0, []byte(`{"severity":"high"}`), now, "Papua", 5.4, "usgs").
		AddRow("firms:20260715:1", 70.0, []byte(`{"severity":"medium"}`), now, "Kalimantan", 0.0, "nasa-firms").
		AddRow("contest:historical:1", 60.0, []byte(`{"severity":"low"}`), now, "Legacy", 2.0, "legacy-import")

	mock.ExpectQuery(`(?s)FROM risk_scores rs.*WHERE rs.entity_type = 'event'.*regexp_replace.*e\.source.*regexp_replace.*rs\.entity_id.*ORDER BY rs\.score DESC.*LIMIT 50`).
		WillReturnRows(rows)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/v1/risk-scores", nil)

	RiskScores(db)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data []RiskScore `json:"data"`
		Meta struct {
			Count int `json:"count"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Meta.Count != 4 || len(response.Data) != 4 {
		t.Fatalf("expected 4 production risk scores, got count=%d rows=%d", response.Meta.Count, len(response.Data))
	}
	want := []string{"bmkg:20260715:1", "us7000real", "firms:20260715:1", "contest:historical:1"}
	for i, entityID := range want {
		if response.Data[i].EntityID != entityID {
			t.Fatalf("row %d entity_id = %q, want %q", i, response.Data[i].EntityID, entityID)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestConnectorHealthIncludesBMKGAirQualityExpectedIntervalThreshold(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT name, last_polled_at, items_fetched, error_message, updated_at").
		WillReturnRows(sqlmock.NewRows([]string{
			"name", "last_polled_at", "items_fetched", "error_message", "updated_at",
		}))

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/health/connectors", nil)

	ConnectorHealthHandler(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data []ConnectorHealth `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	for _, connector := range response.Data {
		if connector.Name == "bmkg_air_quality" {
			if connector.ThresholdSeconds != 7200 || connector.Status != "stale" {
				t.Fatalf("unexpected BMKG air-quality health: %#v", connector)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet SQL expectations: %v", err)
			}
			return
		}
	}
	t.Fatal("bmkg_air_quality missing from connector health output")
}

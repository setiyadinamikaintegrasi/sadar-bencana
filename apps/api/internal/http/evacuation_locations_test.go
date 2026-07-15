package http

import (
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func nearestCtx(query string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/api/v1/evacuation-locations/nearest"+query, nil)
	return c
}

func TestParseNearestParams(t *testing.T) {
	lat, lon, radius, err := parseNearestParams(nearestCtx("?lat=-6.2&lon=106.8"))
	if err != nil {
		t.Fatalf("valid params rejected: %v", err)
	}
	if lat != -6.2 || lon != 106.8 || radius != 25 {
		t.Fatalf("got lat=%v lon=%v radius=%v", lat, lon, radius)
	}
}

func TestParseNearestParamsRejectsAndCaps(t *testing.T) {
	if _, _, _, err := parseNearestParams(nearestCtx("?lat=abc&lon=106.8")); err == nil {
		t.Fatal("lat non-angka harus ditolak")
	}
	if _, _, _, err := parseNearestParams(nearestCtx("?lon=106.8")); err == nil {
		t.Fatal("lat kosong harus ditolak")
	}
	if _, _, _, err := parseNearestParams(nearestCtx("?lat=95&lon=106.8")); err == nil {
		t.Fatal("lat di luar rentang harus ditolak")
	}
	_, _, radius, err := parseNearestParams(nearestCtx("?lat=-6.2&lon=106.8&radius_km=500"))
	if err != nil || radius != 100 {
		t.Fatalf("radius harus di-cap 100, got %v err=%v", radius, err)
	}
}

func TestDetectActiveDisasterFiltersNonProductionEventsBeforeLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`(?s)SELECT event_type, latitude, longitude FROM events.*WHERE latitude.*regexp_replace.*source.*regexp_replace.*event_id.*ORDER BY event_time DESC LIMIT 50`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"event_type", "latitude", "longitude"}).
			AddRow("earthquake", -6.2, 106.8))

	if got := detectActiveDisaster(nearestCtx("?lat=-6.2&lon=106.8"), db, -6.2, 106.8); got != "earthquake" {
		t.Fatalf("detected disaster = %q, want earthquake", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

package http

import (
	"net/http/httptest"
	"testing"

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

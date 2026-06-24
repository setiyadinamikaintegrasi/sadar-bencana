package http

import (
	"math"
	"testing"
)

func TestHaversineKmKnownDistance(t *testing.T) {
	// Jakarta (-6.2088,106.8210) to Bandung (-6.9175,107.6191) ≈ 117 km.
	got := haversineKm(-6.2088, 106.8210, -6.9175, 107.6191)
	if math.Abs(got-117) > 6 {
		t.Fatalf("expected ~117 km, got %.2f", got)
	}
}

func TestHaversineKmZero(t *testing.T) {
	if got := haversineKm(1, 2, 1, 2); got != 0 {
		t.Fatalf("expected 0 for identical points, got %.6f", got)
	}
}

func TestBoundingBoxContainsRadiusEdge(t *testing.T) {
	lat, lon, r := -6.2, 106.8, 50.0
	minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, r)
	if minLat >= lat || maxLat <= lat || minLon >= lon || maxLon <= lon {
		t.Fatalf("box must straddle the center: got %v %v %v %v", minLat, maxLat, minLon, maxLon)
	}
	// A point ~49 km due north must fall inside the box's latitude span.
	northLat := lat + 49.0/111.0
	if northLat > maxLat {
		t.Fatalf("point within radius fell outside box: northLat=%.5f maxLat=%.5f", northLat, maxLat)
	}
}

func TestEventTypeToPeril(t *testing.T) {
	cases := map[string]string{
		"earthquake": "earthquake",
		"quake":      "earthquake",
		"wildfire":   "fire",
		"fire":       "fire",
		"volcano":    "volcano",
		"flood":      "flood",
		"storm":      "windstorm",
		"unknown":    "other",
	}
	for in, want := range cases {
		if got := eventTypeToPeril(in); got != want {
			t.Fatalf("eventTypeToPeril(%q) = %q, want %q", in, got, want)
		}
	}
}

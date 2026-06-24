package http

import (
	"math"
	"strings"
)

const earthRadiusKm = 6371.0

// haversineKm returns the great-circle distance in kilometres between two points.
func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	rLat1 := lat1 * math.Pi / 180
	rLat2 := lat2 * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(rLat1)*math.Cos(rLat2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// boundingBox returns a lat/lon rectangle that fully contains the radiusKm circle
// around (lat, lon). Used as a cheap index-friendly prefilter before haversine.
func boundingBox(lat, lon, radiusKm float64) (minLat, maxLat, minLon, maxLon float64) {
	latDelta := radiusKm / 111.0 // ~111 km per degree latitude
	cos := math.Cos(lat * math.Pi / 180)
	if cos < 0.01 {
		cos = 0.01 // guard near the poles
	}
	lonDelta := radiusKm / (111.0 * cos)
	return lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta
}

// eventTypeToPeril maps a normalized event_type string to a peril enum value.
func eventTypeToPeril(eventType string) string {
	t := strings.ToLower(strings.TrimSpace(eventType))
	switch {
	case strings.Contains(t, "earthquake") || strings.Contains(t, "quake"):
		return "earthquake"
	case strings.Contains(t, "wildfire") || strings.Contains(t, "fire"):
		return "fire"
	case strings.Contains(t, "volcano"):
		return "volcano"
	case strings.Contains(t, "flood"):
		return "flood"
	case strings.Contains(t, "storm") || strings.Contains(t, "cyclone") || strings.Contains(t, "wind"):
		return "windstorm"
	default:
		return "other"
	}
}

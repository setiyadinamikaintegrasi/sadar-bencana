package http

import (
	"database/sql"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Sprint 5 S2: ringkasan fasilitas kritis (critical facilities) dalam radius
// sebuah titik — pasangan natural S1 (populasi terdampak) untuk popup event
// dan impact engine: saat gempa M6.2 terjadi, operator langsung tahu ada
// berapa rumah sakit/puskesmas/polisi/damkar dalam radius dampak.
//
// Sumber data: evacuation_locations (fasilitas publik hasil sinkron OSM +
// entri manual admin) — satu sumber kebenaran, tanpa tabel baru.

const (
	criticalFacilitiesDefaultRadiusKm = 30.0
	criticalFacilitiesMaxRadiusKm     = 200.0
	criticalFacilitiesMaxResults      = 500
)

var criticalFacilityTypes = map[string]string{
	"rumah_sakit":     "rumah_sakit",
	"puskesmas":       "puskesmas",
	"kantor_polisi":   "kantor_polisi",
	"damkar":          "damkar",
	"shelter":         "shelter",
	"tes":             "tes",
	"tea":             "tea",
	"posko_bnpb_bpbd": "posko_bnpb_bpbd",
	"pos_sar":         "pos_sar",
	"gudang_logistik": "gudang_logistik",
}

// criticalFacilityRow adalah satu fasilitas terdekat.
type criticalFacilityRow struct {
	ID           string
	Name         string
	LocationType string
	Latitude     float64
	Longitude    float64
	DistanceKm   float64
}

// CriticalFacilitiesSummary melayani ringkasan fasilitas dalam radius titik.
//
// GET /api/v1/spatial/critical-facilities?lat=-6.2&lon=106.8&radius_km=30[&types=rumah_sakit,damkar]
func CriticalFacilitiesSummary(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		lat, err := strconv.ParseFloat(c.Query("lat"), 64)
		lon, lonErr := strconv.ParseFloat(c.Query("lon"), 64)
		if err != nil || lonErr != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
			math.IsNaN(lat) || math.IsNaN(lon) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_coords"})
			return
		}
		radius := criticalFacilitiesDefaultRadiusKm
		if raw := strings.TrimSpace(c.Query("radius_km")); raw != "" {
			parsed, rErr := strconv.ParseFloat(raw, 64)
			if rErr != nil || parsed <= 0 || parsed > criticalFacilitiesMaxRadiusKm || math.IsNaN(parsed) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_radius"})
				return
			}
			radius = parsed
		}
		typeFilter := map[string]bool{}
		if raw := strings.TrimSpace(c.Query("types")); raw != "" {
			for _, part := range strings.Split(raw, ",") {
				key := strings.TrimSpace(part)
				if key == "" {
					continue
				}
				if _, known := criticalFacilityTypes[key]; !known {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_type", "type": key})
					return
				}
				typeFilter[key] = true
			}
		}

		// Prefetch bbox lalu filter haversine presisi di aplikasi — konsisten
		// dengan pola EvacuationLocationsNearest; bbox memakai margin aman.
		minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, radius)
		rows, err := db.QueryContext(c.Request.Context(), `
			SELECT id, name, location_type, latitude, longitude
			FROM evacuation_locations
			WHERE is_active = TRUE
			  AND latitude BETWEEN $1 AND $2
			  AND longitude BETWEEN $3 AND $4
			ORDER BY (latitude - $5)^2 + (longitude - $6)^2
			LIMIT $7`,
			minLat, maxLat, minLon, maxLon, lat, lon, criticalFacilitiesMaxResults*4,
		)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		counts := make(map[string]int)
		var facilities []criticalFacilityRow
		for rows.Next() {
			var row criticalFacilityRow
			if err := rows.Scan(&row.ID, &row.Name, &row.LocationType, &row.Latitude, &row.Longitude); err != nil {
				continue
			}
			if len(typeFilter) > 0 && !typeFilter[row.LocationType] {
				continue
			}
			distance := haversineKm(lat, lon, row.Latitude, row.Longitude)
			if distance > radius {
				continue
			}
			row.DistanceKm = math.Round(distance*100) / 100
			counts[row.LocationType]++
			if len(facilities) < criticalFacilitiesMaxResults {
				facilities = append(facilities, row)
			}
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "rows_iteration_failed"})
			return
		}

		items := make([]gin.H, 0, len(facilities))
		for _, f := range facilities {
			items = append(items, gin.H{
				"id": f.ID, "name": f.Name, "location_type": f.LocationType,
				"latitude": f.Latitude, "longitude": f.Longitude, "distance_km": f.DistanceKm,
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"origin":      gin.H{"latitude": lat, "longitude": lon},
			"radius_km":   radius,
			"counts":      counts,
			"total":       len(facilities),
			"truncated":   len(facilities) >= criticalFacilitiesMaxResults,
			"facilities":  items,
			"attribution": "OpenStreetMap contributors",
		}})
	}
}

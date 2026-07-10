package http

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func parseNearestParams(c *gin.Context) (lat, lon, radius float64, err error) {
	lat, err = strconv.ParseFloat(c.Query("lat"), 64)
	if err != nil || lat < -90 || lat > 90 {
		return 0, 0, 0, errInvalidCoordinate
	}
	lon, err = strconv.ParseFloat(c.Query("lon"), 64)
	if err != nil || lon < -180 || lon > 180 {
		return 0, 0, 0, errInvalidCoordinate
	}
	radius = 25
	if raw := c.Query("radius_km"); raw != "" {
		radius, err = strconv.ParseFloat(raw, 64)
		if err != nil || radius <= 0 {
			return 0, 0, 0, errInvalidCoordinate
		}
	}
	if radius > 100 {
		radius = 100
	}
	return lat, lon, radius, nil
}

var errInvalidCoordinate = errInvalid("lat/lon/radius_km tidak valid")

type errInvalid string

func (e errInvalid) Error() string { return string(e) }

// EvacuationLocationsList mengembalikan lokasi aktif untuk render peta.
// Filter opsional: bbox viewport (min_lat,max_lat,min_lon,max_lon) dan
// location_type. Kapasitas dijaga LIMIT 5000.
func EvacuationLocationsList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		where := []string{"is_active = TRUE"}
		args := []any{}
		n := 1
		appendFloat := func(param, clause string) bool {
			raw := c.Query(param)
			if raw == "" {
				return true
			}
			v, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				return false
			}
			where = append(where, clause+"$"+strconv.Itoa(n))
			args = append(args, v)
			n++
			return true
		}
		ok := appendFloat("min_lat", "latitude >= ") && appendFloat("max_lat", "latitude <= ") &&
			appendFloat("min_lon", "longitude >= ") && appendFloat("max_lon", "longitude <= ")
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_bbox", "message": "parameter bbox harus angka"})
			return
		}
		if lt := c.Query("location_type"); lt != "" {
			if !validEvacuationLocationTypes[lt] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_location_type"})
				return
			}
			where = append(where, "location_type = $"+strconv.Itoa(n))
			args = append(args, lt)
			n++
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT `+evacuationLocationColumns+` FROM evacuation_locations
			 WHERE `+strings.Join(where, " AND ")+`
			 ORDER BY name LIMIT 5000`, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()
		locations := make([]EvacuationLocation, 0)
		for rows.Next() {
			loc, err := scanEvacuationLocation(rows)
			if err != nil {
				continue
			}
			locations = append(locations, loc)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"locations": locations, "count": len(locations)}})
	}
}

type nearestResult struct {
	EvacuationLocation
	DistanceKM   float64 `json:"distance_km"`
	WalkMinutes  int     `json:"walk_minutes"`
	DriveMinutes int     `json:"drive_minutes"`
}

// detectActiveDisaster mencari jenis bencana dari event aktif (24 jam
// terakhir) terdekat dalam 25 km. String kosong = tidak ada.
func detectActiveDisaster(c *gin.Context, db *sql.DB, lat, lon float64) string {
	minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, 25)
	rows, err := db.QueryContext(c.Request.Context(), `
SELECT event_type, latitude, longitude FROM events
WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
  AND event_time >= now() - interval '24 hours'
ORDER BY event_time DESC LIMIT 50`, minLat, maxLat, minLon, maxLon)
	if err != nil {
		return ""
	}
	defer rows.Close()
	best, bestDist := "", 26.0
	for rows.Next() {
		var eventType string
		var eLat, eLon float64
		if rows.Scan(&eventType, &eLat, &eLon) != nil {
			continue
		}
		if d := haversineKm(lat, lon, eLat, eLon); d <= 25 && d < bestDist {
			best, bestDist = eventType, d
		}
	}
	return best
}

// EvacuationLocationsNearest melayani tombol "Cari Tempat Aman".
func EvacuationLocationsNearest(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		lat, lon, radius, err := parseNearestParams(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_params", "message": err.Error()})
			return
		}
		disaster := strings.ToLower(strings.TrimSpace(c.Query("disaster_type")))
		detection := "manual"
		if disaster == "" {
			disaster = detectActiveDisaster(c, db, lat, lon)
			detection = "auto"
			if disaster == "" {
				detection = "none"
			}
		}
		recommended := recommendedLocationTypes(disaster)

		minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, radius)
		args := []any{minLat, maxLat, minLon, maxLon}
		typeFilter := ""
		if recommended != nil {
			typeFilter = " AND location_type = ANY($5::text[])"
			args = append(args, toPGTextArray(recommended))
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT `+evacuationLocationColumns+` FROM evacuation_locations
			 WHERE is_active = TRUE
			   AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4`+
				typeFilter+` LIMIT 2000`, args...)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()
		results := make([]nearestResult, 0)
		for rows.Next() {
			loc, err := scanEvacuationLocation(rows)
			if err != nil {
				continue
			}
			d := haversineKm(lat, lon, loc.Latitude, loc.Longitude)
			if d > radius {
				continue
			}
			walk, drive := travelEstimates(d)
			results = append(results, nearestResult{
				EvacuationLocation: loc, DistanceKM: d,
				WalkMinutes: walk, DriveMinutes: drive,
			})
		}
		sort.Slice(results, func(i, j int) bool { return results[i].DistanceKM < results[j].DistanceKM })
		if len(results) > 10 {
			results = results[:10]
		}
		var disasterOut any
		if disaster != "" {
			disasterOut = disaster
		}
		var recommendedOut any
		if recommended != nil {
			recommendedOut = recommended
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"origin":            gin.H{"latitude": lat, "longitude": lon},
			"disaster_type":     disasterOut,
			"detection":         detection,
			"recommended_types": recommendedOut,
			"results":           results,
			"radius_km":         radius,
			"assessed_at":       time.Now().UTC(),
			"status_note":       "Rekomendasi berbasis kategori lokasi terdaftar; tetap ikuti arahan resmi BMKG/BNPB/BPBD.",
		}})
	}
}

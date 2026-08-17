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

// EvacuationLocationsListAdmin mengembalikan SELURUH lokasi (aktif dan
// nonaktif) untuk pengelolaan admin — beda dari EvacuationLocationsList
// (publik) yang cuma tampilkan is_active=TRUE.
func EvacuationLocationsListAdmin(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT `+evacuationLocationColumns+` FROM evacuation_locations
			 ORDER BY is_active DESC, name LIMIT 5000`)
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
var detectActiveDisasterQuery = `
SELECT event_type, latitude, longitude FROM events
WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
  AND event_time >= now() - interval '24 hours'
  AND ` + productionEventSQLPredicate("source", "event_id") + `
ORDER BY event_time DESC LIMIT 50`

func detectActiveDisaster(c *gin.Context, db *sql.DB, lat, lon float64) string {
	minLat, maxLat, minLon, maxLon := boundingBox(lat, lon, 25)
	rows, err := db.QueryContext(c.Request.Context(), detectActiveDisasterQuery, minLat, maxLat, minLon, maxLon)
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

		// runQuery mem-prefetch kandidat dalam bbox, diurutkan berdasarkan
		// jarak-perkiraan ke origin sebelum LIMIT, supaya truncation tidak
		// membuang kandidat yang sebenarnya paling dekat (lihat catatan
		// review: ORDER BY wajib ada sebelum LIMIT pada query bbox).
		runQuery := func(types []string) ([]nearestResult, error) {
			args := []any{minLat, maxLat, minLon, maxLon, lat, lon}
			typeFilter := ""
			if types != nil {
				typeFilter = " AND location_type = ANY($7::text[])"
				args = append(args, toPGTextArray(types))
			}
			rows, err := db.QueryContext(c.Request.Context(),
				`SELECT `+evacuationLocationColumns+` FROM evacuation_locations
				 WHERE is_active = TRUE
				   AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4`+
					typeFilter+`
				 ORDER BY (latitude - $5)^2 + (longitude - $6)^2
				 LIMIT 2000`, args...)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := make([]nearestResult, 0)
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
				out = append(out, nearestResult{
					EvacuationLocation: loc, DistanceKM: d,
					WalkMinutes: walk, DriveMinutes: drive,
				})
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}
			sort.Slice(out, func(i, j int) bool { return out[i].DistanceKM < out[j].DistanceKM })
			if len(out) > 10 {
				out = out[:10]
			}
			return out, nil
		}

		results, err := runQuery(recommended)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}

		// Jika filter tipe lokasi rekomendasi tidak menghasilkan apa pun,
		// fallback ke semua tipe supaya fasilitas terdekat yang sebenarnya
		// ada tidak "hilang" hanya karena bukan kategori ideal untuk jenis
		// bencana yang terdeteksi.
		typeFallback := false
		if len(results) == 0 && recommended != nil {
			results, err = runQuery(nil)
			if err != nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
				return
			}
			if len(results) > 0 {
				typeFallback = true
			}
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
			"type_fallback":     typeFallback,
			"results":           results,
			"radius_km":         radius,
			"assessed_at":       time.Now().UTC(),
			"status_note":       "Rekomendasi berbasis kategori lokasi terdaftar; tetap ikuti arahan resmi BMKG/BNPB/BPBD.",
		}})
	}
}

// EvacuationLocationCreate menambah lokasi manual (admin).
func EvacuationLocationCreate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var body evacuationLocationInput
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := validateEvacuationLocationInput(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		loc, err := scanEvacuationLocation(db.QueryRowContext(c.Request.Context(), `
INSERT INTO evacuation_locations
  (name, location_type, source_type, latitude, longitude, address, photo_url,
   capacity, is_open, is_full, phone, person_in_charge, facilities,
   operating_hours, created_by)
VALUES ($1,$2,'manual',$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10,$11,$12::text[],$13,$14)
RETURNING `+evacuationLocationColumns,
			strings.TrimSpace(body.Name), body.LocationType, body.Latitude, body.Longitude,
			strings.TrimSpace(body.Address), strings.TrimSpace(body.PhotoURL),
			body.Capacity, body.IsOpen, body.IsFull, strings.TrimSpace(body.Phone),
			strings.TrimSpace(body.PersonInCharge), toPGTextArray(body.Facilities),
			strings.TrimSpace(body.OperatingHours), AuthUserID(c)))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insert_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": loc})
	}
}

// EvacuationLocationUpdate mengubah lokasi (admin), termasuk status
// buka/tutup & penuh/tidak, dan is_active.
func EvacuationLocationUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var body evacuationLocationInput
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if err := validateEvacuationLocationInput(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "validation_failed", "message": err.Error()})
			return
		}
		active := true
		if body.IsActive != nil {
			active = *body.IsActive
		}
		loc, err := scanEvacuationLocation(db.QueryRowContext(c.Request.Context(), `
UPDATE evacuation_locations SET
  name=$1, location_type=$2, latitude=$3, longitude=$4, address=$5,
  photo_url=NULLIF($6,''), capacity=$7, is_open=$8, is_full=$9, phone=$10,
  person_in_charge=$11, facilities=$12::text[], operating_hours=$13,
  is_active=$14, updated_at=now()
WHERE id=$15
RETURNING `+evacuationLocationColumns,
			strings.TrimSpace(body.Name), body.LocationType, body.Latitude, body.Longitude,
			strings.TrimSpace(body.Address), strings.TrimSpace(body.PhotoURL),
			body.Capacity, body.IsOpen, body.IsFull, strings.TrimSpace(body.Phone),
			strings.TrimSpace(body.PersonInCharge), toPGTextArray(body.Facilities),
			strings.TrimSpace(body.OperatingHours), active, c.Param("id")))
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "update_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": loc})
	}
}

// EvacuationLocationDelete melakukan soft-delete (is_active=false).
func EvacuationLocationDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		result, err := db.ExecContext(c.Request.Context(),
			`UPDATE evacuation_locations SET is_active=FALSE, updated_at=now() WHERE id=$1`,
			c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "delete_failed", "message": err.Error()})
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
	}
}

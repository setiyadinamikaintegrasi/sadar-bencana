package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// CCTV jalan tol resmi (BPJT Kementerian PUPR + seluruh BUJT) — S12a.
//   GET /api/v1/cctv/cameras?operator=jm&q=cikampek&limit=50
//   GET /api/v1/map/operations/cctv?bbox=minLon,minLat,maxLon,maxLat
// ============================================================================

type CctvCamera struct {
	CameraID      string  `json:"camera_id"`
	TollRoadName  string  `json:"toll_road_name"`
	SegmentName   string  `json:"segment_name"`
	KmPoint       string  `json:"km_point"`
	OperatorCode  string  `json:"operator_code"`
	OperatorName  string  `json:"operator_name"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	StreamURL     string  `json:"stream_url"`
	StreamProtocol string `json:"stream_protocol"`
	IsOnline      bool    `json:"is_online"`
}

const cctvCameraListQuery = `
SELECT camera_id, toll_road_name, COALESCE(segment_name, ''), km_point,
       operator_code, operator_name, latitude, longitude,
       stream_url, stream_protocol, is_online
FROM public_cctv_cameras
WHERE ($1 = '' OR operator_code = $1)
  AND ($2 = '' OR toll_road_name ILIKE '%' || $2 || '%' OR km_point ILIKE '%' || $2 || '%')
ORDER BY operator_code, toll_road_name, km_point
LIMIT $3
`

const cctvCameraGeoQuery = `
SELECT camera_id, toll_road_name, COALESCE(segment_name, ''), km_point,
       operator_code, operator_name, latitude, longitude,
       stream_url, stream_protocol, is_online
FROM public_cctv_cameras
WHERE latitude BETWEEN $2 AND $4
  AND longitude BETWEEN $1 AND $3
ORDER BY latitude, longitude
LIMIT 1000
`

// CctvCamerasList melayani daftar kamera CCTV dengan filter.
func CctvCamerasList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		operator := strings.TrimSpace(c.Query("operator"))
		q := strings.TrimSpace(c.Query("q"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if limit < 1 || limit > 500 {
			limit = 50
		}

		rows, err := db.QueryContext(c.Request.Context(), cctvCameraListQuery, operator, q, limit)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		cameras := []CctvCamera{}
		for rows.Next() {
			var cam CctvCamera
			if err := rows.Scan(&cam.CameraID, &cam.TollRoadName, &cam.SegmentName,
				&cam.KmPoint, &cam.OperatorCode, &cam.OperatorName,
				&cam.Latitude, &cam.Longitude, &cam.StreamURL,
				&cam.StreamProtocol, &cam.IsOnline); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			cameras = append(cameras, cam)
		}
		c.JSON(http.StatusOK, gin.H{"cameras": cameras, "count": len(cameras)})
	}
}

// CctvCamerasGeoJSON melayani kamera dalam bounding box sebagai GeoJSON
// FeatureCollection untuk layer MapLibre.
func CctvCamerasGeoJSON(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		bbox := strings.Split(strings.TrimSpace(c.Query("bbox")), ",")
		if len(bbox) != 4 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bbox wajib format minLon,minLat,maxLon,maxLat"})
			return
		}
		coords := make([]float64, 4)
		for i, raw := range bbox {
			v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "bbox tidak valid"})
				return
			}
			coords[i] = v
		}
		// Sanitasi: bbox harus valid (min < max).
		if coords[0] >= coords[2] || coords[1] >= coords[3] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bbox tidak valid (min harus < max)"})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), cctvCameraGeoQuery,
			coords[0], coords[1], coords[2], coords[3])
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		features := []map[string]any{}
		for rows.Next() {
			var cam CctvCamera
			if err := rows.Scan(&cam.CameraID, &cam.TollRoadName, &cam.SegmentName,
				&cam.KmPoint, &cam.OperatorCode, &cam.OperatorName,
				&cam.Latitude, &cam.Longitude, &cam.StreamURL,
				&cam.StreamProtocol, &cam.IsOnline); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			features = append(features, map[string]any{
				"type": "Feature",
				"id":   cam.CameraID,
				"geometry": map[string]any{
					"type":        "Point",
					"coordinates": []float64{cam.Longitude, cam.Latitude},
				},
				"properties": map[string]any{
					"toll_road":      cam.TollRoadName,
					"km":             cam.KmPoint,
					"operator":       cam.OperatorName,
					"operator_code":  cam.OperatorCode,
					"stream_url":     cam.StreamURL,
					"is_online":      cam.IsOnline,
				},
			})
		}
		c.JSON(http.StatusOK, gin.H{
			"type":     "FeatureCollection",
			"features": features,
		})
	}
}

package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 6 S6: overlay Shakemap MMI BMKG untuk event gempa. Mengembalikan
// GeoJSON FeatureCollection point (episenter) dengan properti georeferensi
// gambar (URL + bbox 4 sudut) sehingga klien MapLibre dapat memasang
// image-source; plus URL gambar langsung untuk pratinjau detail event.

const shakemapQuery = `
SELECT s.event_id, s.shakemap_key, s.image_url, s.magnitude,
       COALESCE(s.depth_km, 0), s.latitude, s.longitude,
       s.min_longitude, s.min_latitude, s.max_longitude, s.max_latitude,
       s.felt_reports, e.place, s.fetched_at
FROM shakemap_overlays s
LEFT JOIN events e ON e.event_id = s.event_id
`

// OperationMapShakemaps melayani overlay shakemap dalam bbox viewport.
func OperationMapShakemaps(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("shakemaps", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{timeMode: operationMapNoTime})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), shakemapQuery+`
			WHERE s.latitude BETWEEN $1 AND $2 AND s.longitude BETWEEN $3 AND $4
			ORDER BY s.fetched_at DESC
			LIMIT 50`,
			query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude,
		)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		type shakemapRow struct {
			EventID                        string
			Key                            string
			ImageURL                       string
			Magnitude                      float64
			DepthKm                        float64
			Lat, Lng                       float64
			MinLng, MinLat, MaxLng, MaxLat float64
			Felt                           string
			Place                          sql.NullString
			FetchedAt                      time.Time
		}
		features := make([]OperationMapFeature, 0, 8)
		for rows.Next() {
			var r shakemapRow
			if err := rows.Scan(&r.EventID, &r.Key, &r.ImageURL, &r.Magnitude, &r.DepthKm,
				&r.Lat, &r.Lng, &r.MinLng, &r.MinLat, &r.MaxLng, &r.MaxLat, &r.Felt, &r.Place, &r.FetchedAt); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			magnitude := r.Magnitude
			label := "Shakemap M " + strconv.FormatFloat(magnitude, 'f', 1, 64)
			if r.Place.Valid && r.Place.String != "" {
				label = label + " · " + r.Place.String
			}
			features = append(features, operationMapPointFeature("shakemap:"+r.Key, "shakemaps", label, r.Lng, r.Lat,
				OperationMapFeatureProperties{
					ID: "shakemap:" + r.Key, Layer: "shakemaps",
					PerilType:          "earthquake",
					Source:             "bmkg",
					Attribution:        "BMKG",
					VerificationStatus: "official",
					Magnitude:          &magnitude,
					ShakemapURL:        r.ImageURL,
					ShakemapBBox:       &[4]float64{r.MinLng, r.MinLat, r.MaxLng, r.MaxLat},
					FeltReports:        r.Felt,
					EventID:            r.EventID,
					// ObservedAt dalam UTC RFC3339 ('Z') — validator klien memakai pola ketat.
					ObservedAt: utcTimePtr(r.FetchedAt),
				}))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("shakemaps", features, truncated))
	}
}

// utcTimePtr menyalin waktu ke zona UTC agar serialisasi JSON memakai 'Z'
// (validator klien mapApi hanya menerima RFC3339 berakhiran Z).
func utcTimePtr(t time.Time) *time.Time {
	utc := t.UTC()
	return &utc
}

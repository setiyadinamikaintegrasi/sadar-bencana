package http

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 6 S7: status genangan banjir per area RW/RT (PetaBencana/BPBD)
// sebagai GeoJSON Polygon berwarna per kedalaman (state 1-4) untuk overlay
// peta. Sumber connector worker apps/worker (sinkron 10 menit).

const operationMapFloodAreasLimit = 2000

const operationMapFloodAreasQuery = `
SELECT area_id, area_name, parent_name, city_name, district, state, geometry,
       min_longitude, min_latitude, max_longitude, max_latitude, updated_at
FROM flood_areas
WHERE max_latitude >= $1 AND min_latitude <= $2
  AND max_longitude >= $3 AND min_longitude <= $4
ORDER BY state DESC, updated_at DESC
LIMIT $5
`

// OperationMapFloodAreas melayani poligon area terendam dalam bbox viewport.
func OperationMapFloodAreas(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("flood-areas", started, &status, &featureCount, &truncated)

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

		rows, err := db.QueryContext(c.Request.Context(), operationMapFloodAreasQuery,
			query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude,
			operationMapFloodAreasLimit+1,
		)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		features := make([]OperationMapFeature, 0, 16)
		for rows.Next() {
			var (
				areaID, areaName, parentName, cityName, district string
				state                                            int
				geometryJSON                                     []byte
				minLng, minLat, maxLng, maxLat                   float64
				updatedAt                                        time.Time
			)
			if err := rows.Scan(&areaID, &areaName, &parentName, &cityName, &district,
				&state, &geometryJSON, &minLng, &minLat, &maxLng, &maxLat, &updatedAt); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapFloodAreasLimit {
				truncated = true
				break
			}
			var geometry json.RawMessage
			if err := json.Unmarshal(geometryJSON, &geometry); err != nil {
				continue // poligon korup di-skip, bukan gagal total
			}
			label := fmt.Sprintf("Genangan %s — %s, %s (state %d)", areaName, parentName, cityName, state)
			features = append(features, OperationMapFeature{
				Type:     "Feature",
				ID:       "flood-area:" + areaID,
				Geometry: geometry,
				Properties: OperationMapFeatureProperties{
					ID: "flood-area:" + areaID, Layer: "flood-areas",
					Label:              label,
					PerilType:          "flood",
					Source:             "petabencana",
					Attribution:        "PetaBencana.id / BPBD",
					VerificationStatus: "official",
					LocationType:       fmt.Sprintf("state-%d", state),
					ObservedAt:         utcTimePtr(updatedAt),
				},
			})
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		featureCount, status = len(features), http.StatusOK
		writePublicOperationMapJSON(c, status, operationMapCollection("flood-areas", features, truncated))
	}
}

package http

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Public, viewport-bounded live aircraft positions (OpenSky ingest via the
// Python worker). Serves the latest snapshot row per aircraft (icao24 is
// unique in aircraft_positions) so the payload stays bounded even though the
// worker refreshes positions on its 60s scheduler.

const operationMapAircraftLimit = 1000

var operationMapAircraftQuery = fmt.Sprintf(`
SELECT icao24, callsign, origin_country, latitude, longitude,
       altitude, velocity, heading, "timestamp"
FROM aircraft_positions
WHERE latitude BETWEEN $1 AND $2
  AND longitude BETWEEN $3 AND $4
  AND on_ground = false
  AND "timestamp" > now() - interval '24 hours'
ORDER BY "timestamp" DESC
LIMIT %d
`, operationMapAircraftLimit)

// OperationMapAircraft serves public aircraft position features for the map.
func OperationMapAircraft(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status, featureCount, truncated := http.StatusInternalServerError, 0, false
		defer operationMapTelemetry("aircraft", started, &status, &featureCount, &truncated)

		if db == nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_unavailable")
			return
		}
		query, err := parseOperationMapQuery(c, operationMapQueryOptions{})
		if err != nil {
			status = http.StatusBadRequest
			operationMapError(c, status, "invalid_query")
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), operationMapAircraftQuery,
			query.BBox.MinLatitude, query.BBox.MaxLatitude,
			query.BBox.MinLongitude, query.BBox.MaxLongitude,
		)
		if err != nil {
			status = http.StatusServiceUnavailable
			operationMapError(c, status, "database_query_failed")
			return
		}
		defer rows.Close()

		type aircraftRow struct {
			icao24, callsign, origin sql.NullString
			latitude, longitude      float64
			altitude, velocity, heading sql.NullFloat64
			observedAt               time.Time
		}

		features := make([]OperationMapFeature, 0, 128)
		for rows.Next() {
			var r aircraftRow
			if err := rows.Scan(&r.icao24, &r.callsign, &r.origin, &r.latitude, &r.longitude, &r.altitude, &r.velocity, &r.heading, &r.observedAt); err != nil {
				status = http.StatusInternalServerError
				operationMapError(c, status, "row_scan_failed")
				return
			}
			if len(features) == operationMapAircraftLimit {
				truncated = true
				break
			}
			callsign := nullableOperationMapString(r.callsign)
			if callsign == "" {
				callsign = nullableOperationMapString(r.icao24)
			}
			_ = r.velocity
			features = append(features, operationMapPointFeature(
				"aircraft:"+nullableOperationMapString(r.icao24),
				"aircraft",
				callsign,
				r.longitude,
				r.latitude,
				OperationMapFeatureProperties{
					PerilType:          "aircraft",
					Source:             "opensky",
					Attribution:        "The OpenSky Network",
					VerificationStatus: "source-reported",
					ObservedAt:         operationMapTimePtr(r.observedAt),
					HeadingDeg:         operationMapFloat64Ptr(headingForMap(r.heading)),
					VelocityMS:         operationMapFloat64Ptr(r.velocity),
					AltitudeM:          operationMapFloat64Ptr(r.altitude),
					Unit:               "m",
					Category:           nullableOperationMapString(r.origin),
				},
			))
		}
		if err := rows.Err(); err != nil {
			status = http.StatusInternalServerError
			operationMapError(c, status, "rows_iteration_failed")
			return
		}

		status = http.StatusOK
		featureCount = len(features)
		writePublicOperationMapJSON(c, status, operationMapCollection("aircraft", features, truncated))
	}
}

// headingForMap normalizes a nullable heading into a presentable number.
func headingForMap(heading sql.NullFloat64) sql.NullFloat64 {
	if !heading.Valid {
		return heading
	}
	h := heading.Float64
	for h < 0 {
		h += 360
	}
	for h >= 360 {
		h -= 360
	}
	heading.Float64 = h
	return heading
}

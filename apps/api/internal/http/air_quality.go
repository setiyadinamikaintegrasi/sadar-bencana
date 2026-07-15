package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const airQualitySourceActiveQuery = `
SELECT enabled AND run_mode = 'active' AS source_active
FROM official_source_settings
WHERE source_name = 'bmkg_air_quality'
`

const airQualityLatestQuery = `
WITH latest AS (
  SELECT DISTINCT ON (o.station_id, o.pollutant)
         o.id, o.source, o.station_id, o.station_name, o.latitude, o.longitude,
         o.pollutant, o.value, o.unit, o.category, o.observed_at, o.source_url,
         (o.observed_at < now() - make_interval(secs => 2 * s.expected_interval_seconds)) AS stale,
         o.ingested_at
  FROM air_quality_observations o
  JOIN official_source_settings s ON s.source_name = 'bmkg_air_quality'
  WHERE ($1 = '' OR o.source = $1)
  ORDER BY o.station_id, o.pollutant, o.observed_at DESC, o.id ASC
)
SELECT id, source, station_id, station_name, latitude, longitude, pollutant,
       value, unit, category, observed_at, source_url, stale, ingested_at
FROM latest
ORDER BY CASE category
           WHEN 'Berbahaya' THEN 5 WHEN 'Sangat Tidak Sehat' THEN 4
           WHEN 'Tidak Sehat' THEN 3 WHEN 'Sedang' THEN 2 ELSE 1
         END DESC,
         observed_at DESC,
         station_id ASC,
         pollutant ASC,
         id ASC
LIMIT $2
`

const airQualityHistoryQuery = `
SELECT o.id, o.source, o.station_id, o.station_name, o.latitude, o.longitude,
       o.pollutant, o.value, o.unit, o.category, o.observed_at, o.source_url,
       (o.observed_at < now() - make_interval(secs => 2 * s.expected_interval_seconds)) AS stale,
       o.ingested_at
FROM air_quality_observations o
JOIN official_source_settings s ON s.source_name = 'bmkg_air_quality'
WHERE ($1 = '' OR o.source = $1)
ORDER BY CASE o.category
           WHEN 'Berbahaya' THEN 5 WHEN 'Sangat Tidak Sehat' THEN 4
           WHEN 'Tidak Sehat' THEN 3 WHEN 'Sedang' THEN 2 ELSE 1
         END DESC,
         o.observed_at DESC,
         o.station_id ASC,
         o.pollutant ASC,
         o.id ASC
LIMIT $2
`

// AirQualityObservation is a public BMKG PM2.5 measurement. It deliberately
// contains only the presentation-safe fields selected by the endpoint.
type AirQualityObservation struct {
	ID          string    `json:"id"`
	Source      string    `json:"source"`
	StationID   string    `json:"station_id"`
	StationName string    `json:"station_name"`
	Latitude    *float64  `json:"latitude"`
	Longitude   *float64  `json:"longitude"`
	Pollutant   string    `json:"pollutant"`
	Value       float64   `json:"value"`
	Unit        string    `json:"unit"`
	Category    string    `json:"category"`
	ObservedAt  time.Time `json:"observed_at"`
	SourceURL   *string   `json:"source_url"`
	Stale       bool      `json:"stale"`
	IngestedAt  time.Time `json:"ingested_at"`
}

func airQualityLimit(raw string) (int, bool) {
	if strings.TrimSpace(raw) == "" {
		return 50, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 50 {
		return 0, false
	}
	return limit, true
}

// AirQualityObservations lists BMKG PM2.5 observations, either as the latest
// reading per station/pollutant or as bounded history.
func AirQualityObservations(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "database_unavailable", "message": "the database is not configured",
			})
			return
		}
		if err := c.Request.Context().Err(); err != nil {
			c.JSON(http.StatusRequestTimeout, gin.H{
				"error": "request_cancelled", "message": err.Error(),
			})
			return
		}

		params := c.Request.URL.Query()
		for name, values := range params {
			if (name != "source" && name != "latest" && name != "limit") || len(values) != 1 {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "invalid_query", "message": "only source, latest, and limit may be supplied once",
				})
				return
			}
		}

		source := c.Query("source")
		if source != "" && source != "bmkg" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid_source", "message": "source must be bmkg when supplied",
			})
			return
		}

		latest := true
		if values, supplied := params["latest"]; supplied {
			switch values[0] {
			case "true":
				latest = true
			case "false":
				latest = false
			default:
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "invalid_latest", "message": "latest must be true or false",
				})
				return
			}
		}

		limit, valid := airQualityLimit(c.Query("limit"))
		if !valid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid_limit", "message": "limit must be an integer between 1 and 50",
			})
			return
		}

		sourceActive := false
		err := db.QueryRowContext(c.Request.Context(), airQualitySourceActiveQuery).Scan(&sourceActive)
		if err != nil && err != sql.ErrNoRows {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "source_status_query_failed", "message": err.Error(),
			})
			return
		}

		query := airQualityLatestQuery
		if !latest {
			query = airQualityHistoryQuery
		}
		rows, err := db.QueryContext(c.Request.Context(), query, source, limit)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "database_query_failed", "message": err.Error(),
			})
			return
		}
		defer rows.Close()

		observations := make([]AirQualityObservation, 0, limit)
		for rows.Next() {
			var observation AirQualityObservation
			var latitude, longitude sql.NullFloat64
			var sourceURL sql.NullString
			if err := rows.Scan(
				&observation.ID,
				&observation.Source,
				&observation.StationID,
				&observation.StationName,
				&latitude,
				&longitude,
				&observation.Pollutant,
				&observation.Value,
				&observation.Unit,
				&observation.Category,
				&observation.ObservedAt,
				&sourceURL,
				&observation.Stale,
				&observation.IngestedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "row_scan_failed", "message": err.Error(),
				})
				return
			}
			observation.Latitude = nullFloat64Ptr(latitude)
			observation.Longitude = nullFloat64Ptr(longitude)
			observation.SourceURL = nullStringPtr(sourceURL)
			observations = append(observations, observation)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "rows_iteration_failed", "message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": observations,
			"meta": gin.H{
				"count": len(observations), "limit": limit, "latest": latest, "source_active": sourceActive,
			},
		})
	}
}

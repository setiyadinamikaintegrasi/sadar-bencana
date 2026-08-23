package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Kualitas udara ASEAN (OpenAQ ground stations) — dampak asap lintas batas.
// GET /api/v1/air-quality/asean — publik, snapshot terbaru per hub.
// ============================================================================

type AseanAirQualityEntry struct {
	HubCode     string  `json:"hub_code"`
	HubName     string  `json:"hub_name"`
	Country     string  `json:"country"`
	StationName string  `json:"station_name"`
	Pm25        float64 `json:"pm25"`
	AqiCategory string  `json:"aqi_category"`
	MeasuredAt  string  `json:"measured_at"`
	FetchedAt   string  `json:"fetched_at"`
}

type AseanAirQualityResponse struct {
	Data        []AseanAirQualityEntry `json:"data"`
	UnhealthyCount int                 `json:"unhealthy_count"`
	GeneratedAt string                 `json:"generated_at"`
}

const aseanAirQualityQuery = `
SELECT hub_code, hub_name, country,
       COALESCE(station_name, ''),
       COALESCE(pm25, 0),
       COALESCE(aqi_category, ''),
       COALESCE(measured_at::text, ''),
       fetched_at::text
FROM asean_air_quality
ORDER BY pm25 DESC
`

// AseanAirQualityList melayani snapshot kualitas udara ASEAN terbaru.
// Publik (tanpa auth) — data agregat lintas batas utk kesadaran regional.
func AseanAirQualityList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), aseanAirQualityQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		entries := []AseanAirQualityEntry{}
		unhealthy := 0
		for rows.Next() {
			var e AseanAirQualityEntry
			var measuredAt, fetchedAt string
			if err := rows.Scan(&e.HubCode, &e.HubName, &e.Country, &e.StationName,
				&e.Pm25, &e.AqiCategory, &measuredAt, &fetchedAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			if measuredAt != "" {
				if t, err := time.Parse("2006-01-02 15:04:05.999999999-07", measuredAt[:min(29, len(measuredAt))]); err == nil {
					e.MeasuredAt = t.UTC().Format(time.RFC3339)
				}
			}
			if fetchedAt != "" {
				if t, err := time.Parse("2006-01-02 15:04:05.999999999-07", fetchedAt[:min(29, len(fetchedAt))]); err == nil {
					e.FetchedAt = t.UTC().Format(time.RFC3339)
				}
			}
			entries = append(entries, e)
			if e.Pm25 > 35.4 {
				unhealthy++
			}
		}
		c.JSON(http.StatusOK, AseanAirQualityResponse{
			Data:           entries,
			UnhealthyCount: unhealthy,
			GeneratedAt:    time.Now().UTC().Format(time.RFC3339),
		})
	}
}

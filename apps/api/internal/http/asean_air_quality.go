package http

import (
	"database/sql"
	"math"
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
	IsStale     bool    `json:"is_stale"`
	AgeHours    float64 `json:"age_hours"`
	// ModelOpenMeteo: PM2.5 dari model CAMS (Open-Meteo AQ) utk hub ID
	// terdekat — perbandingan ground vs model (S8-P7).
	ModelPm25 *float64 `json:"model_pm25,omitempty"`
}

type AseanAirQualityResponse struct {
	Data        []AseanAirQualityEntry `json:"data"`
	UnhealthyCount int                 `json:"unhealthy_count"`
	GeneratedAt string                 `json:"generated_at"`
}

const aseanAirQualityQuery = `
SELECT a.hub_code, a.hub_name, a.country,
       COALESCE(a.station_name, ''),
       COALESCE(a.pm25, 0),
       COALESCE(a.aqi_category, ''),
       COALESCE(a.measured_at::text, ''),
       a.fetched_at::text,
       COALESCE(EXTRACT(EPOCH FROM (now() - a.measured_at)) / 3600.0, 999999),
       a.stale_after_hours,
       r.pm25
FROM asean_air_quality a
LEFT JOIN region_air_quality r
  ON r.region_code = CASE
    WHEN a.country = 'ID' THEN 'jawa'
    WHEN a.hub_code = 'kuching' OR a.hub_code = 'kota-kinabalu' OR a.hub_code = 'brunei' THEN 'kalimantan'
    WHEN a.hub_code IN ('singapore', 'johor', 'penang', 'kl', 'hat-yai') THEN 'sumatera'
    ELSE NULL END
ORDER BY a.pm25 DESC
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
			var ageHours, staleAfter float64
			var modelPm25 sql.NullFloat64
			if err := rows.Scan(&e.HubCode, &e.HubName, &e.Country, &e.StationName,
				&e.Pm25, &e.AqiCategory, &measuredAt, &fetchedAt,
				&ageHours, &staleAfter, &modelPm25); err != nil {
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
			e.AgeHours = math.Round(ageHours*10) / 10
			e.IsStale = ageHours > staleAfter
			if modelPm25.Valid {
				v := math.Round(modelPm25.Float64*10) / 10
				e.ModelPm25 = &v
			}
			entries = append(entries, e)
			if e.Pm25 > 35.4 && !e.IsStale {
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

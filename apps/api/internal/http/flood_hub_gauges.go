package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Prakiraan banjir sungai per gauge (Google Flood Hub) — S9-P2.
// GET /api/v1/flood-hub/gauges — publik; kosong bila key belum diset.
// ============================================================================

type FloodHubGauge struct {
	GaugeID       string  `json:"gauge_id"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	RiverName     string  `json:"river_name"`
	StationName   string  `json:"station_name"`
	State         string  `json:"state"`
	SeverityLevel int     `json:"severity_level"`
	SeverityLabel string  `json:"severity_label"`
	Value         float64 `json:"value"`
	IssuedAt      string  `json:"issued_at"`
}

type FloodHubResponse struct {
	Data           []FloodHubGauge `json:"data"`
	WarningCount   int             `json:"warning_count"`
	DangerCount    int             `json:"danger_count"`
	GeneratedAt    string          `json:"generated_at"`
}

var floodHubSeverityLabels = map[int]string{
	1: "Normal",
	2: "Waspada",
	3: "Bahaya",
	4: "Bahaya Ekstrem",
}

const floodHubGaugeQuery = `
SELECT g.gauge_id,
       g.latitude, g.longitude,
       g.river_name, g.station_name, g.state,
       COALESCE(f.severity_level, 1),
       COALESCE(f.value, 0),
       COALESCE(f.issued_at::text, '')
FROM flood_hub_gauges g
LEFT JOIN flood_hub_forecasts f ON f.gauge_id = g.gauge_id
ORDER BY COALESCE(f.severity_level, 1) DESC, g.river_name ASC
`

// FloodHubGaugesList melayani daftar gauge + prakiraan terbaru.
func FloodHubGaugesList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), floodHubGaugeQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		gauges := []FloodHubGauge{}
		warnings, dangers := 0, 0
		for rows.Next() {
			var g FloodHubGauge
			var issuedAt string
			if err := rows.Scan(&g.GaugeID, &g.Latitude, &g.Longitude,
				&g.RiverName, &g.StationName, &g.State,
				&g.SeverityLevel, &g.Value, &issuedAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			g.SeverityLabel = floodHubSeverityLabels[g.SeverityLevel]
			if floodHubSeverityLabels[g.SeverityLevel] == "" {
				g.SeverityLabel = "Normal"
			}
			if issuedAt != "" {
				if t, err := time.Parse("2006-01-02 15:04:05.999999999-07", issuedAt[:min(29, len(issuedAt))]); err == nil {
					g.IssuedAt = t.UTC().Format(time.RFC3339)
				}
			}
			if g.SeverityLevel == 2 {
				warnings++
			} else if g.SeverityLevel >= 3 {
				dangers++
			}
			gauges = append(gauges, g)
		}
		c.JSON(http.StatusOK, FloodHubResponse{
			Data:         gauges,
			WarningCount: warnings,
			DangerCount:  dangers,
			GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		})
	}
}

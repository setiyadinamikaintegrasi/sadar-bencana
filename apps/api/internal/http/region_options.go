package http

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Daftar wilayah administratif (provinsi) — pendamping RegionalHistoryProfile
// agar UI bisa dropdown nama wilayah, bukan input kode manual.
// GET /api/v1/historical/regions — publik.
// ============================================================================

type RegionOption struct {
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	Level     string  `json:"level"`
	CenterLon float64 `json:"center_lon"`
	CenterLat float64 `json:"center_lat"`
}

const regionOptionsQuery = `
SELECT code, name, level,
       COALESCE((min_longitude + max_longitude) / 2.0, 0),
       COALESCE((min_latitude + max_latitude) / 2.0, 0)
FROM administrative_boundaries
WHERE level = 'province'
ORDER BY name ASC
`

// RegionOptionsList melayani daftar provinsi untuk pemilihan wilayah.
func RegionOptionsList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), regionOptionsQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		regions := []RegionOption{}
		for rows.Next() {
			var r RegionOption
			if err := rows.Scan(&r.Code, &r.Name, &r.Level, &r.CenterLon, &r.CenterLat); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			regions = append(regions, r)
		}
		c.JSON(http.StatusOK, gin.H{"regions": regions})
	}
}

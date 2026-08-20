package http

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 5 S3: distribusi tutupan lahan (ESA WorldCover 10m v100/2020) dalam
// poligon bebas — konteks eksposur (hutan/pertanian/kawasan terbangun/air)
// untuk popup event dan impact engine. Pasangan S1 (populasi) & S2 (fasilitas).

var worldCoverClassLabels = map[int]string{
	10:  "tree_cover",
	20:  "shrubland",
	30:  "grassland",
	40:  "cropland",
	50:  "built_up",
	60:  "bare_sparse",
	70:  "snow_ice",
	80:  "water",
	90:  "wetland",
	95:  "mangroves",
	100: "moss_lichen",
}

type landcoverClassRow struct {
	ClassCode   int
	SampleCount int64
	Fraction    float64
}

// SpatialLandcoverSummary melayani distribusi kelas tutupan lahan dalam poligon.
//
// GET /api/v1/spatial/landcover-summary?polygon=WKT
func SpatialLandcoverSummary(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		wkt := strings.TrimSpace(c.Query("polygon"))
		if wkt == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "polygon_required"})
			return
		}
		area, ok := parseWKTPolygon(wkt)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_polygon"})
			return
		}
		if area > spatialPopulationMaxAreaDeg2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "polygon_too_large"})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT class_code, sample_count, fraction FROM zonal_landcover_summary(ST_GeomFromText($1, 4326))`,
			wkt,
		)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()

		classes := make([]gin.H, 0)
		var totalSamples int64
		for rows.Next() {
			var row landcoverClassRow
			if err := rows.Scan(&row.ClassCode, &row.SampleCount, &row.Fraction); err != nil {
				continue
			}
			label, known := worldCoverClassLabels[row.ClassCode]
			if !known {
				label = "other"
			}
			classes = append(classes, gin.H{
				"class_code":   row.ClassCode,
				"class":        label,
				"sample_count": row.SampleCount,
				"fraction":     row.Fraction,
			})
			totalSamples += row.SampleCount
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "rows_iteration_failed"})
			return
		}

		var vintage, attribution string
		var resolutionM int32
		var ingestedAt time.Time
		var featureCount int64
		dErr := db.QueryRowContext(c.Request.Context(),
			`SELECT vintage, attribution, resolution_m, ingested_at, feature_count
			 FROM spatial_datasets WHERE dataset = 'worldcover_landcover'`,
		).Scan(&vintage, &attribution, &resolutionM, &ingestedAt, &featureCount)
		dataset := gin.H{"dataset": "worldcover_landcover"}
		if dErr == nil {
			dataset = gin.H{
				"dataset":       "worldcover_landcover",
				"vintage":       vintage,
				"attribution":   attribution,
				"resolution_m":  resolutionM,
				"ingested_at":   ingestedAt,
				"feature_count": featureCount,
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"total_samples": totalSamples,
			"classes":       classes,
			"dataset":       dataset,
		}})
	}
}

package http

import (
	"database/sql"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 5 S1: statistik zonal populasi (WorldPop 1km UNadj) untuk poligon
// bebas — dasar exposure-aware risk scoring dan ringkasan dampak peta.
// Endpoint publik read-only dengan batas kuota geometri agar tidak jadi
// beban query berat: maksimum vertex dan luas bbox dibatasi.

const (
	spatialPopulationMaxVertices = 128
	spatialPopulationMaxAreaDeg2 = 30.0
)

type spatialPopulationSummaryRow struct {
	Population float64
	Cells      int64
}

type spatialDatasetRow struct {
	Dataset      string
	Vintage      string
	ResolutionM  int32
	Attribution  string
	IngestedAt   time.Time
	FeatureCount int64
}

// parseWKTPolygon memvalidasi WKT POLYGON ring luar: jumlah vertex terbatas,
// koordinat finite, ring tertutup. Mengembalikan luas bbox dalam derajat².
func parseWKTPolygon(wkt string) (areaDeg2 float64, ok bool) {
	trimmed := strings.TrimSpace(wkt)
	if !strings.HasPrefix(strings.ToUpper(trimmed), "POLYGON") {
		return 0, false
	}
	open := strings.Index(trimmed, "((")
	closeIdx := strings.LastIndex(trimmed, "))")
	if open < 0 || closeIdx < open {
		return 0, false
	}
	body := trimmed[open+2 : closeIdx]
	// Hanya ring luar yang dipakai; ring lubang ditolak agar semantik jelas.
	if strings.Contains(body, "),(") {
		return 0, false
	}
	parts := strings.Split(body, ",")
	if len(parts) < 4 || len(parts) > spatialPopulationMaxVertices+1 {
		return 0, false
	}
	minLon, maxLon := math.Inf(1), math.Inf(-1)
	minLat, maxLat := math.Inf(1), math.Inf(-1)
	for i, part := range parts {
		coords := strings.Fields(strings.TrimSpace(part))
		if len(coords) != 2 {
			return 0, false
		}
		lon, errLon := strconv.ParseFloat(coords[0], 64)
		lat, errLat := strconv.ParseFloat(coords[1], 64)
		if errLon != nil || errLat != nil || !isFiniteGeo(lon, lat) {
			return 0, false
		}
		minLon, maxLon = math.Min(minLon, lon), math.Max(maxLon, lon)
		minLat, maxLat = math.Min(minLat, lat), math.Max(maxLat, lat)
		_ = i
	}
	// Ring harus tertutup (titik awal == akhir dalam presisi string koordinat).
	first := strings.Fields(strings.TrimSpace(parts[0]))
	last := strings.Fields(strings.TrimSpace(parts[len(parts)-1]))
	if len(first) != 2 || len(last) != 2 || first[0] != last[0] || first[1] != last[1] {
		return 0, false
	}
	return (maxLon - minLon) * (maxLat - minLat), true
}

func isFiniteGeo(lon, lat float64) bool {
	return !math.IsNaN(lon) && !math.IsInf(lon, 0) && lon >= -180 && lon <= 180 &&
		!math.IsNaN(lat) && !math.IsInf(lat, 0) && lat >= -90 && lat <= 90
}

// SpatialPopulationSummary melayani ringkasan populasi dalam poligon.
func SpatialPopulationSummary(db *sql.DB) gin.HandlerFunc {
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

		var summary spatialPopulationSummaryRow
		err := db.QueryRowContext(c.Request.Context(),
			`SELECT population, cells FROM zonal_population_summary(ST_GeomFromText($1, 4326))`, wkt,
		).Scan(&summary.Population, &summary.Cells)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}

		var dataset spatialDatasetRow
		dErr := db.QueryRowContext(c.Request.Context(),
			`SELECT dataset, vintage, resolution_m, attribution, ingested_at, feature_count
			 FROM spatial_datasets WHERE dataset = 'worldpop_population'`,
		).Scan(&dataset.Dataset, &dataset.Vintage, &dataset.ResolutionM, &dataset.Attribution, &dataset.IngestedAt, &dataset.FeatureCount)
		if dErr != nil {
			// Metadata opsional: grid tetap valid meski baris metadata belum ada.
			dataset = spatialDatasetRow{Dataset: "worldpop_population"}
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"population": summary.Population,
			"cells":      summary.Cells,
			"dataset": gin.H{
				"dataset":       dataset.Dataset,
				"vintage":       dataset.Vintage,
				"resolution_m":  dataset.ResolutionM,
				"attribution":   dataset.Attribution,
				"ingested_at":   dataset.IngestedAt,
				"feature_count": dataset.FeatureCount,
			},
		}})
	}
}

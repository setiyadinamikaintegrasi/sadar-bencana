package http

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/elevation"
)

// Sprint 5 S4: ringkasan medan (elevasi) untuk bbox area dampak — dari AWS
// Terrain Tiles terrarium (turunan SRTM; sumber sama dengan layer terrain 3D
// peta). Sampler dibagikan antar-request (cache LRU di memori).

var (
	elevationSamplerOnce sync.Once
	elevationSampler     *elevation.Sampler
)

func getElevationSampler() *elevation.Sampler {
	elevationSamplerOnce.Do(func() {
		elevationSampler = elevation.NewSampler(256)
	})
	return elevationSampler
}

// SpatialElevationSummary melayani ringkasan medan untuk bbox.
//
// GET /api/v1/spatial/elevation-summary?min_lng&min_lat&max_lng&max_lat
func SpatialElevationSummary() gin.HandlerFunc {
	return func(c *gin.Context) {
		bounds, ok := parseElevationBBox(c)
		if !ok {
			return // respons error sudah ditulis parser.
		}
		if bounds.MinLng == 0 && bounds.MinLat == 0 && bounds.MaxLng == 0 && bounds.MaxLat == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bbox_required"})
			return
		}
		if bounds.MinLng >= bounds.MaxLng || bounds.MinLat >= bounds.MaxLat ||
			bounds.MinLng < -180 || bounds.MaxLng > 180 || bounds.MinLat < -90 || bounds.MaxLat > 90 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_bbox"})
			return
		}
		if (bounds.MaxLng-bounds.MinLng)*(bounds.MaxLat-bounds.MinLat) > spatialPopulationMaxAreaDeg2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bbox_too_large"})
			return
		}

		// Step grid adaptif: ±1 km (0.01°) hingga maksimum ~400 sampel agar
		// latency dan volume unduhan tile tetap terkendali.
		span := bounds.MaxLng - bounds.MinLng
		if latSpan := bounds.MaxLat - bounds.MinLat; latSpan > span {
			span = latSpan
		}
		step := 0.01
		if span/step > 400 {
			step = span / 400
		}

		summary, err := getElevationSampler().ElevationGrid(c.Request.Context(),
			bounds.MinLng, bounds.MinLat, bounds.MaxLng, bounds.MaxLat, step)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "elevation_unavailable"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"min_m":         roundTo(summary.MinM, 1),
			"max_m":         roundTo(summary.MaxM, 1),
			"mean_m":        roundTo(summary.MeanM, 1),
			"roughness_m":   roundTo(summary.Roughness, 1),
			"steep_percent": roundTo(summary.SteepPercent, 1),
			"water_percent": roundTo(summary.WaterPercent, 1),
			"samples":       summary.Samples,
			"land_samples":  summary.LandSamples,
			"source":        "AWS Terrain Tiles (terrarium; SRTM dst.)",
			"attribution":   "Mapzen terrain tiles © OpenStreetMap contributors · NASA SRTM",
		}})
	}
}

// parseElevationBBox membaca & memvalidasi bbox; menulis respons error
// sendiri dan mengembalikan ok=false bila tidak valid.
func parseElevationBBox(c *gin.Context) (bounds struct {
	MinLng, MinLat, MaxLng, MaxLat float64
}, ok bool) {
	parse := func(key string) (float64, bool) {
		raw := strings.TrimSpace(c.Query(key))
		if raw == "" {
			return 0, false
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
		return value, true
	}
	var lngOK, latOK [2]bool
	bounds.MinLng, lngOK[0] = parse("min_lng")
	bounds.MaxLng, lngOK[1] = parse("max_lng")
	bounds.MinLat, latOK[0] = parse("min_lat")
	bounds.MaxLat, latOK[1] = parse("max_lat")
	if !lngOK[0] || !lngOK[1] || !latOK[0] || !latOK[1] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bbox_required"})
		return bounds, false
	}
	if bounds.MinLng >= bounds.MaxLng || bounds.MinLat >= bounds.MaxLat ||
		bounds.MinLng < -180 || bounds.MaxLng > 180 || bounds.MinLat < -90 || bounds.MaxLat > 90 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_bbox"})
		return bounds, false
	}
	if (bounds.MaxLng-bounds.MinLng)*(bounds.MaxLat-bounds.MinLat) > spatialPopulationMaxAreaDeg2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bbox_too_large"})
		return bounds, false
	}
	return bounds, true
}

func roundTo(value float64, digits int) float64 {
	factor := 1.0
	for i := 0; i < digits; i++ {
		factor *= 10
	}
	return math.Round(value*factor) / factor
}

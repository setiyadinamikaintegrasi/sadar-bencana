package http

import (
	"context"
	"database/sql"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/impact"
)

// Sprint 6 S5: impact engine — skor dampak event on-demand dengan faktor
// lengkap dari data spasial Sprint 5:
//
//	exposure       <- WorldPop zonal (S1) radius adaptif per peril
//	vulnerability  <- medan SRTM steep% (S4) + landcover terbangun/pertanian
//	                  (S3) + perairan (S4) diperbesar utk perils berbasis air
//	hazard         <- magnitude/depth per peril (port risk-v2 worker)
//	freshness      <- usia event
//
// Respons explainable: seluruh komponen, bobot, input spasial, dan fallback.

// impactRadiusKm per peril: radius dampak tipikal untuk menentukan area
// ringkasan spasial (gempa besar lebih luas; banjir mengikuti cekungan
// lokal; karhutla area terbakar).
func impactRadiusKm(perilType string, magnitude float64) float64 {
	switch perilType {
	case "earthquake":
		switch {
		case magnitude >= 7.0:
			return 80
		case magnitude >= 6.0:
			return 50
		default:
			return 30
		}
	case "tsunami":
		return 100
	case "flood":
		return 25
	case "volcano":
		return 40
	case "wildfire":
		return 20
	default:
		return 30
	}
}

// impactEventRow adalah data event dari DB yang dibutuhkan scoring.
type impactEventRow struct {
	ID         string
	PerilType  string
	Magnitude  float64
	DepthKm    sql.NullFloat64
	EventTime  time.Time
	Latitude   float64
	Longitude  float64
}

// SpatialImpactScore melayani skor dampak satu event.
//
// GET /api/v1/spatial/impact-score?event_id=...
func SpatialImpactScore(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_unavailable"})
			return
		}
		eventID := strings.TrimSpace(c.Query("event_id"))
		if eventID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "event_id_required"})
			return
		}

		var event impactEventRow
		// depth tidak disimpan di tabel events (BMKG feed tanpa kedalaman) —
		// EventInput memakai 0 = tak diketahui (depth factor netral 1.0).
		// Feature map mengirim id "source:event_id" (event_id DB sudah
		// ber-prefix "bmkg:..."), jadi terima exact ATAU suffix-match untuk
		// menoleransi bentuk "bmkg:bmkg:...".
		var depth sql.NullFloat64
		err := db.QueryRowContext(c.Request.Context(), `
			SELECT id, event_type, COALESCE(magnitude, 0), event_time, latitude, longitude
			FROM events
			WHERE event_id = $1 OR event_id = $2 OR right($1, length(event_id)) = event_id
			LIMIT 1`, eventID, strings.TrimPrefix(eventID, firstSegment(eventID)+":"),
		).Scan(&event.ID, &event.PerilType, &event.Magnitude, &event.EventTime, &event.Latitude, &event.Longitude)
		event.DepthKm = depth
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "event_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed"})
			return
		}

		radius := impactRadiusKm(event.PerilType, event.Magnitude)
		ctxSpatial, spatialMeta := gatherSpatialContext(c.Request.Context(), db, event.Latitude, event.Longitude, radius)

		input := impact.EventInput{
			PerilType: event.PerilType,
			Magnitude: event.Magnitude,
			DepthKm:   event.DepthKm.Float64,
			AgeHours:  time.Since(event.EventTime).Hours(),
		}
		score, components, fallbacks := impact.Score(input, ctxSpatial)

		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"event_id":    event.ID,
			"peril_type":  event.PerilType,
			"magnitude":   event.Magnitude,
			"radius_km":   radius,
			"score":       score,
			"score_label": impactLabel(score),
			"formula_version": impact.FormulaVersion,
			"components":  components,
			"weights":     impact.Weights,
			"spatial":     spatialMeta,
			"fallbacks":   fallbacks,
		}})
	}
}

// gatherSpatialContext merangkai S1-S4 untuk satu titik. Gagal parsial
// (mis. tile elevasi lambat) tidak menggagalkan skor — komponen terkait
// memakai fallback aman dan dilaporkan di fallbacks.
func gatherSpatialContext(ctx context.Context, db *sql.DB, lat, lng float64, radiusKm float64) (impact.SpatialContext, gin.H) {
	var result impact.SpatialContext
	meta := gin.H{"radius_km": radiusKm}

	// S1 + S3: poligon bbox ring.
	dLat := radiusKm / 111.32
	cosLat := math.Max(0.2, math.Cos(lat*math.Pi/180))
	dLon := radiusKm / (111.32 * cosLat)
	wkt := "POLYGON((" +
		formatDeg(lng-dLon) + " " + formatDeg(lat-dLat) + ", " +
		formatDeg(lng+dLon) + " " + formatDeg(lat-dLat) + ", " +
		formatDeg(lng+dLon) + " " + formatDeg(lat+dLat) + ", " +
		formatDeg(lng-dLon) + " " + formatDeg(lat+dLat) + ", " +
		formatDeg(lng-dLon) + " " + formatDeg(lat-dLat) + "))"

	// Populasi (S1).
	var population float64
	if err := db.QueryRowContext(ctx,
		`SELECT population FROM zonal_population_summary(ST_GeomFromText($1, 4326))`, wkt,
	).Scan(&population); err == nil {
		result.Population = population
		result.PopulationKnown = true
		meta["population"] = math.Round(population)
	}

	// Landcover (S3): fraksi built-up & cropland.
	rows, err := db.QueryContext(ctx,
		`SELECT class_code, fraction FROM zonal_landcover_summary(ST_GeomFromText($1, 4326))`, wkt)
	if err == nil {
		for rows.Next() {
			var classCode int
			var fraction float64
			if err := rows.Scan(&classCode, &fraction); err != nil {
				continue
			}
			switch classCode {
			case 50:
				result.BuiltUpFraction = fraction
			case 40:
				result.CropFraction = fraction
			}
			result.LandcoverKnown = true
		}
		rows.Close()
	}

	// Elevasi (S4) — on-demand dari tile AWS.
	sampler := getElevationSampler()
	if summary, err := sampler.ElevationGrid(ctx, lng-dLon, lat-dLat, lng+dLon, lat+dLat, gridStepForRadius(radiusKm)); err == nil {
		result.SteepPercent = summary.SteepPercent
		result.WaterPercent = summary.WaterPercent
		meta["elevation"] = gin.H{"min_m": summary.MinM, "max_m": summary.MaxM, "steep_percent": summary.SteepPercent, "water_percent": summary.WaterPercent}
	}

	// Fasilitas (S2) — hanya total (komponen informasional; skor memakai
	// fasilitas untuk meta, bukan bobot langsung).
	var facilities int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM evacuation_locations
		WHERE is_active = TRUE
		  AND latitude  BETWEEN $1 AND $2
		  AND longitude BETWEEN $3 AND $4`,
		lat-dLat, lat+dLat, lng-dLon, lng+dLon,
	).Scan(&facilities); err == nil {
		result.FacilitiesTotal = facilities
		result.FacilitiesKnown = true
		meta["critical_facilities"] = facilities
	}

	return result, meta
}

func gridStepForRadius(radiusKm float64) float64 {
	// Grid ~1 km hingga maksimum ±400 sampel.
	span := radiusKm * 2 / 111.32
	step := 0.01
	if span/step > 400 {
		step = span / 400
	}
	return step
}

// firstSegment mengembalikan segmen sebelum ':' pertama ("bmkg:bmkg:x" -> "bmkg").
func firstSegment(value string) string {
	if idx := strings.Index(value, ":"); idx >= 0 {
		return value[:idx]
	}
	return value
}

func formatDeg(v float64) string {
	return strconv.FormatFloat(v, 'f', 4, 64)
}

// impactLabel mengonversi skor ke label baku triage.
func impactLabel(score float64) string {
	switch {
	case score >= 75:
		return "catastrophic"
	case score >= 55:
		return "major"
	case score >= 35:
		return "moderate"
	case score >= 15:
		return "minor"
	default:
		return "negligible"
	}
}

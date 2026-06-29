package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type MapOverlay struct {
	ID          string          `json:"id"`
	LayerClass  string          `json:"layer_class"`
	PerilType   *string         `json:"peril_type"`
	Label       string          `json:"label"`
	Geometry    json.RawMessage `json:"geometry"`
	Latitude    *float64        `json:"latitude"`
	Longitude   *float64        `json:"longitude"`
	RadiusKM    *float64        `json:"radius_km"`
	EffectiveAt *time.Time      `json:"effective_at"`
	ExpiresAt   *time.Time      `json:"expires_at"`
	DataVintage *string         `json:"data_vintage"`
	Attribution *string         `json:"attribution"`
	SourceURL   *string         `json:"source_url"`
}

const officialOverlayQuery = `
SELECT id, headline, area_geojson, effective_at, expires_at, source
FROM official_alerts
WHERE area_geojson IS NOT NULL
  AND sent_at >= now() - interval '7 days'
ORDER BY sent_at DESC
LIMIT 200
`

const riskContextOverlayQuery = `
SELECT rc.id, rc.peril_type, rc.context_key, rc.area_geojson,
       rc.data_vintage::text, sr.attribution, sr.source_url
FROM risk_context rc
JOIN source_records sr ON sr.id = rc.source_record_id
WHERE rc.area_geojson IS NOT NULL
ORDER BY rc.created_at DESC
LIMIT 200
`

const watchZoneOverlayQuery = `
SELECT id, label, latitude, longitude, radius_km
FROM ews_watch_zones
WHERE is_active = TRUE
ORDER BY created_at DESC
LIMIT 500
`

// MapRiskOverlays returns official, static-risk, and watch-zone layers separately.
func MapRiskOverlays(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		overlays := make([]MapOverlay, 0)

		rows, err := db.QueryContext(c.Request.Context(), officialOverlayQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		for rows.Next() {
			var item MapOverlay
			var headline, source sql.NullString
			var geometry []byte
			var effective, expires sql.NullTime
			if err := rows.Scan(&item.ID, &headline, &geometry, &effective, &expires, &source); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			item.LayerClass = "official"
			item.Label = valueOr(headline, "Peringatan resmi")
			item.Geometry = geometry
			item.Attribution = nullStringPtr(source)
			if effective.Valid {
				item.EffectiveAt = &effective.Time
			}
			if expires.Valid {
				item.ExpiresAt = &expires.Time
			}
			overlays = append(overlays, item)
		}
		rows.Close()

		rows, err = db.QueryContext(c.Request.Context(), riskContextOverlayQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		for rows.Next() {
			var item MapOverlay
			var peril, vintage, attribution, sourceURL sql.NullString
			var geometry []byte
			if err := rows.Scan(
				&item.ID, &peril, &item.Label, &geometry, &vintage,
				&attribution, &sourceURL,
			); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			item.LayerClass = "static_risk"
			item.PerilType = nullStringPtr(peril)
			item.Geometry = geometry
			item.DataVintage = nullStringPtr(vintage)
			item.Attribution = nullStringPtr(attribution)
			item.SourceURL = nullStringPtr(sourceURL)
			overlays = append(overlays, item)
		}
		rows.Close()

		rows, err = db.QueryContext(c.Request.Context(), watchZoneOverlayQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		for rows.Next() {
			var item MapOverlay
			var latitude, longitude, radius float64
			if err := rows.Scan(&item.ID, &item.Label, &latitude, &longitude, &radius); err != nil {
				rows.Close()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			item.LayerClass = "watch_zone"
			item.Latitude, item.Longitude, item.RadiusKM = &latitude, &longitude, &radius
			overlays = append(overlays, item)
		}
		rows.Close()
		c.JSON(http.StatusOK, gin.H{"data": overlays, "meta": gin.H{"count": len(overlays)}})
	}
}

func valueOr(value sql.NullString, fallback string) string {
	if value.Valid && value.String != "" {
		return value.String
	}
	return fallback
}

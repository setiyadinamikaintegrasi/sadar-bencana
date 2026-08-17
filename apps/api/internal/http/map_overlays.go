package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
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
SELECT id, headline, area_geojson, latitude, longitude, effective_at,
       expires_at, source, peril_type, source_url
FROM official_alerts oa
JOIN official_source_settings s ON s.source_name = oa.source
WHERE oa.is_current = TRUE
  AND oa.status = 'active'
  AND s.enabled = TRUE
  AND s.run_mode = 'active'
  AND (oa.area_geojson IS NOT NULL OR (oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL))
  AND (oa.effective_at IS NULL OR oa.effective_at <= now())
  AND (oa.expires_at IS NULL OR oa.expires_at > now())
ORDER BY oa.sent_at DESC
LIMIT 200
`

const bmkgAttribution = "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)"

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
WHERE is_active = TRUE AND subscriber_id = $1
ORDER BY created_at DESC
LIMIT 500
`

// MapRiskOverlays returns public official and static-risk layers. Watch zones
// are intentionally excluded because they contain subscriber-specific data.
func MapRiskOverlays(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		serveMapRiskOverlays(c, db, nil)
	}
}

// MapRiskOverlaysMe returns public layers plus only the authenticated
// subscriber's watch zones.
func MapRiskOverlaysMe(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subscriberID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		serveMapRiskOverlays(c, db, &subscriberID)
	}
}

func serveMapRiskOverlays(c *gin.Context, db *sql.DB, subscriberID *string) {
	overlays := make([]MapOverlay, 0)

	rows, err := db.QueryContext(c.Request.Context(), officialOverlayQuery)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
		return
	}
	for rows.Next() {
		var item MapOverlay
		var headline, source, perilType, sourceURL sql.NullString
		var latitude, longitude sql.NullFloat64
		var geometry []byte
		var effective, expires sql.NullTime
		if err := rows.Scan(
			&item.ID, &headline, &geometry, &latitude, &longitude, &effective,
			&expires, &source, &perilType, &sourceURL,
		); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
			return
		}
		item.LayerClass = "official"
		item.Label = valueOr(headline, "Peringatan resmi")
		item.Geometry = geometry
		item.PerilType = nullStringPtr(perilType)
		item.Latitude = nullFloat64Ptr(latitude)
		item.Longitude = nullFloat64Ptr(longitude)
		item.SourceURL = nullStringPtr(sourceURL)
		if source.Valid && strings.HasPrefix(strings.ToLower(source.String), "bmkg") {
			attribution := bmkgAttribution
			item.Attribution = &attribution
		} else {
			item.Attribution = nullStringPtr(source)
		}
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

	if subscriberID != nil {
		rows, err = db.QueryContext(c.Request.Context(), watchZoneOverlayQuery, *subscriberID)
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
	}
	c.JSON(http.StatusOK, gin.H{"data": overlays, "meta": gin.H{"count": len(overlays)}})
}

func valueOr(value sql.NullString, fallback string) string {
	if value.Valid && value.String != "" {
		return value.String
	}
	return fallback
}

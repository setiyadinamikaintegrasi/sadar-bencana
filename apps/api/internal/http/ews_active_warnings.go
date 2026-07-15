package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type EWSActiveWarning struct {
	ID                     string          `json:"id"`
	Source                 string          `json:"source"`
	MessageType            string          `json:"message_type"`
	Status                 string          `json:"status"`
	SentAt                 time.Time       `json:"sent_at"`
	PerilType              string          `json:"peril_type"`
	Severity               string          `json:"severity"`
	Category               *string         `json:"category"`
	Headline               *string         `json:"headline"`
	Description            *string         `json:"description"`
	AreaName               *string         `json:"area_name"`
	EffectiveAt            *time.Time      `json:"effective_at"`
	ExpiresAt              *time.Time      `json:"expires_at"`
	SourceURL              *string         `json:"source_url"`
	AreaGeoJSON            json.RawMessage `json:"area_geojson"`
	Latitude               *float64        `json:"latitude"`
	Longitude              *float64        `json:"longitude"`
	MatchedWatchZoneIDs    []string        `json:"matched_watch_zone_ids"`
	MatchedWatchZoneLabels []string        `json:"matched_watch_zone_labels"`
	Guidance               json.RawMessage `json:"guidance"`
	GuidanceSource         *string         `json:"guidance_source"`
}

const ewsMeActiveWarningsQuery = `
SELECT oa.id, oa.source, oa.message_type, oa.status, oa.sent_at, oa.peril_type, oa.severity,
       oa.category, oa.headline, oa.description, oa.area_name,
       oa.effective_at, oa.expires_at, oa.source_url, oa.area_geojson,
       oa.latitude, oa.longitude,
       array_to_json(array_agg(DISTINCT z.id::text)),
       array_to_json(array_agg(DISTINCT z.label)),
       guidance.content, guidance.source_url
FROM official_alerts oa
JOIN ews_watch_zones z
  ON z.subscriber_id = $1
 AND z.is_active = TRUE
 AND (cardinality(z.peril_types) = 0 OR oa.peril_type = ANY(z.peril_types))
 AND (
   (oa.area_geojson IS NOT NULL AND ST_Intersects(
     ST_SetSRID(ST_GeomFromGeoJSON(oa.area_geojson::text), 4326)::geography,
     ST_Buffer(
       ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
       z.radius_km * 1000
     )
   ))
   OR
   (oa.latitude IS NOT NULL AND oa.longitude IS NOT NULL AND ST_DWithin(
     ST_SetSRID(ST_MakePoint(oa.longitude, oa.latitude), 4326)::geography,
     ST_SetSRID(ST_MakePoint(z.longitude, z.latitude), 4326)::geography,
     z.radius_km * 1000
   ))
 )
LEFT JOIN ews_safety_guidance guidance
  ON guidance.peril_type = oa.peril_type
 AND guidance.language_code = 'id'
 AND guidance.is_active = TRUE
WHERE oa.is_current = TRUE
  AND oa.status = 'active'
  AND (oa.effective_at IS NULL OR oa.effective_at <= now())
  AND (oa.expires_at IS NULL OR oa.expires_at > now())
GROUP BY oa.id, guidance.content, guidance.source_url
ORDER BY CASE oa.severity
           WHEN 'Critical' THEN 3 WHEN 'High' THEN 2 ELSE 1
         END DESC,
         COALESCE(oa.effective_at, oa.sent_at) DESC
LIMIT $2
`

func ewsMeActiveWarningsLimit(raw string) int {
	limit := 100
	if value := strings.TrimSpace(raw); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	return limit
}

func nonNullRawJSON(value []byte) json.RawMessage {
	if len(value) == 0 || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return nil
	}
	return json.RawMessage(value)
}

// EWSMeActiveWarnings lists active official warnings that match the subscriber's active watch zones.
func EWSMeActiveWarnings(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		limit := ewsMeActiveWarningsLimit(c.Query("limit"))
		rows, err := db.QueryContext(c.Request.Context(), ewsMeActiveWarningsQuery, subID, limit)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()

		warnings := make([]EWSActiveWarning, 0, limit)
		for rows.Next() {
			var warning EWSActiveWarning
			var category, headline, description, areaName, sourceURL, guidanceSource sql.NullString
			var effectiveAt, expiresAt sql.NullTime
			var latitude, longitude sql.NullFloat64
			var areaGeoJSON, matchedWatchZoneIDs, matchedWatchZoneLabels, guidance []byte
			if err := rows.Scan(
				&warning.ID,
				&warning.Source,
				&warning.MessageType,
				&warning.Status,
				&warning.SentAt,
				&warning.PerilType,
				&warning.Severity,
				&category,
				&headline,
				&description,
				&areaName,
				&effectiveAt,
				&expiresAt,
				&sourceURL,
				&areaGeoJSON,
				&latitude,
				&longitude,
				&matchedWatchZoneIDs,
				&matchedWatchZoneLabels,
				&guidance,
				&guidanceSource,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			if err := json.Unmarshal(matchedWatchZoneIDs, &warning.MatchedWatchZoneIDs); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			if err := json.Unmarshal(matchedWatchZoneLabels, &warning.MatchedWatchZoneLabels); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			warning.Category = nullStringPtr(category)
			warning.Headline = nullStringPtr(headline)
			warning.Description = nullStringPtr(description)
			warning.AreaName = nullStringPtr(areaName)
			if effectiveAt.Valid {
				warning.EffectiveAt = &effectiveAt.Time
			}
			if expiresAt.Valid {
				warning.ExpiresAt = &expiresAt.Time
			}
			warning.SourceURL = nullStringPtr(sourceURL)
			warning.AreaGeoJSON = nonNullRawJSON(areaGeoJSON)
			warning.Latitude = nullFloat64Ptr(latitude)
			warning.Longitude = nullFloat64Ptr(longitude)
			warning.Guidance = nonNullRawJSON(guidance)
			warning.GuidanceSource = nullStringPtr(guidanceSource)
			warnings = append(warnings, warning)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": warnings, "meta": gin.H{"count": len(warnings), "limit": limit}})
	}
}

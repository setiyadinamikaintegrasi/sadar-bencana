package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type OfficialAlert struct {
	ID              string          `json:"id"`
	Source          string          `json:"source"`
	SourceAlertID   string          `json:"source_alert_id"`
	Revision        int             `json:"revision"`
	MessageType     string          `json:"message_type"`
	Status          string          `json:"status"`
	SentAt          time.Time       `json:"sent_at"`
	EffectiveAt     *time.Time      `json:"effective_at"`
	ExpiresAt       *time.Time      `json:"expires_at"`
	Headline        *string         `json:"headline"`
	Description     *string         `json:"description"`
	AreaGeoJSON     json.RawMessage `json:"area_geojson"`
	PreviousAlertID *string         `json:"previous_alert_id"`
	IsCurrent       bool            `json:"is_current"`
	IngestedAt      time.Time       `json:"ingested_at"`
	PerilType       *string         `json:"peril_type"`
	Severity        *string         `json:"severity"`
	Category        *string         `json:"category"`
	AreaName        *string         `json:"area_name"`
	Latitude        *float64        `json:"latitude"`
	Longitude       *float64        `json:"longitude"`
	SourceURL       *string         `json:"source_url"`
}

const officialAlertsQuery = `
SELECT id, source, source_alert_id, revision, message_type, status, sent_at,
       effective_at, expires_at, headline, description, area_geojson,
       previous_alert_id, is_current, ingested_at, peril_type, severity,
       category, area_name, latitude, longitude, source_url
FROM official_alerts
WHERE ($1 = '' OR source = $1)
  AND ($2 = '' OR status = $2)
  AND ($3::boolean OR is_current = TRUE)
  AND ($4 = '' OR peril_type = $4)
  AND (
    status <> 'active'
    OR (
      (effective_at IS NULL OR effective_at <= now())
      AND EXISTS (
        SELECT 1
        FROM official_source_settings s
        WHERE s.source_name = official_alerts.source
          AND s.enabled = TRUE
          AND s.run_mode = 'active'
      )
    )
  )
ORDER BY sent_at DESC, revision DESC
LIMIT $5
`

var officialAlertStatuses = map[string]bool{
	"active":    true,
	"updated":   true,
	"expired":   true,
	"cancelled": true,
}

var officialAlertPerilTypes = map[string]bool{
	"weather":     true,
	"air_quality": true,
}

func officialAlertLimit(raw string) (int, bool) {
	if strings.TrimSpace(raw) == "" {
		return 100, true
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 1 || parsed > 200 {
		return 0, false
	}
	return parsed, true
}

// OfficialAlerts lists current authoritative alerts or their complete revision history.
func OfficialAlerts(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		source := strings.ToLower(strings.TrimSpace(c.Query("source")))
		status := strings.ToLower(strings.TrimSpace(c.Query("status")))
		perilType := strings.ToLower(strings.TrimSpace(c.Query("peril_type")))
		if status != "" && !officialAlertStatuses[status] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_status",
				"message": "status must be active, updated, expired, or cancelled",
			})
			return
		}
		if perilType != "" && !officialAlertPerilTypes[perilType] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_peril_type",
				"message": "peril_type must be weather or air_quality",
			})
			return
		}

		includeHistory := false
		if raw := strings.TrimSpace(c.Query("include_history")); raw != "" {
			parsed, err := strconv.ParseBool(raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "invalid_include_history",
					"message": "include_history must be true or false",
				})
				return
			}
			includeHistory = parsed
		}

		limit, valid := officialAlertLimit(c.Query("limit"))
		if !valid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_limit",
				"message": "limit must be an integer between 1 and 200",
			})
			return
		}

		rows, err := db.QueryContext(
			c.Request.Context(),
			officialAlertsQuery,
			source,
			status,
			includeHistory,
			perilType,
			limit,
		)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		alerts := make([]OfficialAlert, 0, limit)
		for rows.Next() {
			var alert OfficialAlert
			var effectiveAt, expiresAt sql.NullTime
			var headline, description, previousAlertID, perilType, severity, category, areaName, sourceURL sql.NullString
			var latitude, longitude sql.NullFloat64
			var areaGeoJSON []byte
			if err := rows.Scan(
				&alert.ID,
				&alert.Source,
				&alert.SourceAlertID,
				&alert.Revision,
				&alert.MessageType,
				&alert.Status,
				&alert.SentAt,
				&effectiveAt,
				&expiresAt,
				&headline,
				&description,
				&areaGeoJSON,
				&previousAlertID,
				&alert.IsCurrent,
				&alert.IngestedAt,
				&perilType,
				&severity,
				&category,
				&areaName,
				&latitude,
				&longitude,
				&sourceURL,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}

			if effectiveAt.Valid {
				alert.EffectiveAt = &effectiveAt.Time
			}
			if expiresAt.Valid {
				alert.ExpiresAt = &expiresAt.Time
			}
			alert.Headline = nullStringPtr(headline)
			alert.Description = nullStringPtr(description)
			alert.PreviousAlertID = nullStringPtr(previousAlertID)
			alert.PerilType = nullStringPtr(perilType)
			alert.Severity = nullStringPtr(severity)
			alert.Category = nullStringPtr(category)
			alert.AreaName = nullStringPtr(areaName)
			alert.Latitude = nullFloat64Ptr(latitude)
			alert.Longitude = nullFloat64Ptr(longitude)
			alert.SourceURL = nullStringPtr(sourceURL)
			if len(areaGeoJSON) > 0 {
				alert.AreaGeoJSON = json.RawMessage(areaGeoJSON)
			}
			alerts = append(alerts, alert)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": alerts,
			"meta": gin.H{
				"count":           len(alerts),
				"limit":           limit,
				"include_history": includeHistory,
			},
		})
	}
}

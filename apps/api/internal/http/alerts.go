package http

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Alert mirrors an alert row joined with its related event.
type Alert struct {
	ID           string     `json:"id"`
	EventUUID    *string    `json:"event_uuid"`
	EventID      *string    `json:"event_id"`
	Source       *string    `json:"source"`
	Place        *string    `json:"place"`
	Magnitude    *float64   `json:"magnitude"`
	EventTime    *time.Time `json:"event_time"`
	AlertType    string     `json:"alert_type"`
	Severity     string     `json:"severity"`
	Verification string     `json:"verification_status"`
	SourceCount  int        `json:"source_count"`
	Message      *string    `json:"message"`
	Acknowledged bool       `json:"acknowledged"`
	CreatedAt    time.Time  `json:"created_at"`
}

const alertsQuery = `
SELECT a.id,
       a.event_id,
       e.event_id,
       COALESCE(e.source, n.source),
       COALESCE(e.place, n.place_name),
       e.magnitude,
       COALESCE(e.event_time, n.published_at),
       a.alert_type,
       a.severity,
       a.verification_status,
       a.source_count,
       a.message,
       a.acknowledged,
       a.created_at
FROM alerts a
LEFT JOIN events e ON a.event_id = e.id
LEFT JOIN news_items n ON a.news_item_id = n.id
WHERE ($1::boolean IS NULL OR a.acknowledged = $1)
ORDER BY a.created_at DESC
LIMIT 100
`

const unacknowledgedCountQuery = `
SELECT count(*) FROM alerts WHERE acknowledged = FALSE
`

const acknowledgeAlertQuery = `
UPDATE alerts
SET acknowledged = TRUE
WHERE id = $1
RETURNING id
`

// Alerts returns a gin.HandlerFunc that lists recent alerts.
func Alerts(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		var acknowledgedFilter any
		if raw := strings.TrimSpace(c.Query("acknowledged")); raw != "" {
			switch strings.ToLower(raw) {
			case "true":
				acknowledgedFilter = true
			case "false":
				acknowledgedFilter = false
			default:
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "invalid_acknowledged",
					"message": "query parameter 'acknowledged' must be true or false",
				})
				return
			}
		}

		rows, err := db.QueryContext(c.Request.Context(), alertsQuery, acknowledgedFilter)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		alerts := make([]Alert, 0, 100)
		for rows.Next() {
			var alert Alert
			var eventUUID, eventID, source, place, message sql.NullString
			var magnitude sql.NullFloat64
			var eventTime sql.NullTime
			if err := rows.Scan(
				&alert.ID,
				&eventUUID,
				&eventID,
				&source,
				&place,
				&magnitude,
				&eventTime,
				&alert.AlertType,
				&alert.Severity,
				&alert.Verification,
				&alert.SourceCount,
				&message,
				&alert.Acknowledged,
				&alert.CreatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}

			alert.EventUUID = nullStringPtr(eventUUID)
			alert.EventID = nullStringPtr(eventID)
			alert.Source = nullStringPtr(source)
			alert.Place = nullStringPtr(place)
			alert.Magnitude = nullFloat64Ptr(magnitude)
			alert.Message = nullStringPtr(message)
			if eventTime.Valid {
				alert.EventTime = &eventTime.Time
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

		var unacknowledged int
		_ = db.QueryRowContext(c.Request.Context(), unacknowledgedCountQuery).Scan(&unacknowledged)

		c.JSON(http.StatusOK, gin.H{
			"data": alerts,
			"meta": gin.H{
				"count":          len(alerts),
				"limit":          100,
				"unacknowledged": unacknowledged,
			},
		})
	}
}

// AcknowledgeAlert marks a single alert as acknowledged.
func AcknowledgeAlert(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		alertID := strings.TrimSpace(c.Param("id"))
		if alertID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_alert_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var updatedID string
		err := db.QueryRowContext(c.Request.Context(), acknowledgeAlertQuery, alertID).Scan(&updatedID)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{
					"error":   "alert_not_found",
					"message": "no alert found for the provided id",
				})
				return
			}
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"id":           updatedID,
				"acknowledged": true,
			},
		})
	}
}

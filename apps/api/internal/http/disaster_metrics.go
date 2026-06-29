package http

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

const disasterSLOQuery = `
SELECT
  COALESCE(100.0 * count(*) FILTER (WHERE success) / NULLIF(count(*), 0), 100) AS valid_payload_success_pct,
  COALESCE(100.0 * count(*) FILTER (
    WHERE stage = 'notification_sent' AND duration_ms < 60000
  ) / NULLIF(count(*) FILTER (WHERE stage = 'notification_sent'), 0), 100) AS notification_under_60s_pct,
  count(*) FILTER (WHERE success = FALSE) AS failures
FROM disaster_observability_events
WHERE occurred_at >= now() - interval '24 hours'
`

const alertVolumeQuery = `
SELECT COALESCE(e.source, 'derived'), COALESCE(e.event_type, a.alert_type),
       a.severity, count(*)
FROM alerts a
LEFT JOIN events e ON e.id = a.event_id
WHERE a.created_at >= now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY count(*) DESC
`

// DisasterMetrics reports current operational SLOs and alert volume.
func DisasterMetrics(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		var payloadSuccess, notificationFast float64
		var failures int
		if err := db.QueryRowContext(c.Request.Context(), disasterSLOQuery).Scan(
			&payloadSuccess, &notificationFast, &failures,
		); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), alertVolumeQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		volumes := make([]gin.H, 0)
		for rows.Next() {
			var source, peril, severity string
			var count int
			if err := rows.Scan(&source, &peril, &severity, &count); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			volumes = append(volumes, gin.H{"source": source, "peril": peril, "severity": severity, "count": count})
		}
		c.JSON(http.StatusOK, gin.H{
			"window": "24h",
			"slo": gin.H{
				"valid_payload_success_pct":  payloadSuccess,
				"valid_payload_target_pct":   99,
				"notification_under_60s_pct": notificationFast,
				"notification_target_pct":    95,
				"failure_count":              failures,
				"silent_failure_target":      0,
			},
			"alert_volume": volumes,
		})
	}
}

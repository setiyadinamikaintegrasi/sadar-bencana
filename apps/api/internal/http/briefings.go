package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// TopEvent represents one of the highest-magnitude events surfaced in a
// daily briefing.
type TopEvent struct {
	EventID   string  `json:"event_id"`
	Magnitude float64 `json:"magnitude"`
	Place     *string `json:"place"`
	Source    *string `json:"source"`
}

const latestBriefingQuery = `
SELECT id, summary, event_count, created_at
FROM briefings
WHERE briefing_type = 'daily'
ORDER BY created_at DESC
LIMIT 1
`

const briefingTopEventsQuery = `
SELECT e.event_id, e.magnitude, e.place, e.source
FROM briefings b
LEFT JOIN events e ON e.id = ANY(b.event_ids)
WHERE b.id = $1
ORDER BY e.magnitude DESC NULLS LAST
LIMIT 3
`

// BriefingsToday returns the latest generated daily briefing.
//
// If no generated briefing exists yet, it falls back to a stub payload.
// If db is nil (database not available), the handler responds with HTTP 503.
func BriefingsToday(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		today := time.Now().UTC().Format("2006-01-02")

		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		var briefingID string
		var summary string
		var eventCount int
		var createdAt time.Time
		err := db.QueryRowContext(c.Request.Context(), latestBriefingQuery).Scan(
			&briefingID,
			&summary,
			&eventCount,
			&createdAt,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusOK, gin.H{
					"data": gin.H{
						"date":        today,
						"summary":     "Briefing module not yet active",
						"event_count": 0,
						"top_events":  []TopEvent{},
					},
				})
				return
			}
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), briefingTopEventsQuery, briefingID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		topEvents := make([]TopEvent, 0, 3)
		for rows.Next() {
			var te TopEvent
			var place, source sql.NullString
			var magnitude sql.NullFloat64
			if err := rows.Scan(&te.EventID, &magnitude, &place, &source); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			if magnitude.Valid {
				te.Magnitude = magnitude.Float64
			}
			te.Place = nullStringPtr(place)
			te.Source = nullStringPtr(source)
			topEvents = append(topEvents, te)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"date":        createdAt.UTC().Format("2006-01-02"),
				"summary":     summary,
				"event_count": eventCount,
				"top_events":  topEvents,
			},
		})
	}
}

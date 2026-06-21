package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Event mirrors a row of the events table.
type Event struct {
	ID        string    `json:"id"`
	EventID   string    `json:"event_id"`
	Source    string    `json:"source"`
	EventType string    `json:"event_type"`
	Magnitude float64   `json:"magnitude"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Place     string    `json:"place"`
	EventTime time.Time `json:"event_time"`
	URL       string    `json:"url"`
	Severity  string    `json:"severity"`
	CreatedAt time.Time `json:"created_at"`
}

// eventsQuery selects the most recent 50 events ordered by event_time.
const eventsQuery = `
SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
       place, event_time, url, severity, created_at
FROM events
ORDER BY event_time DESC
LIMIT 50
`

// Events returns a gin.HandlerFunc that lists the most recent events.
// If db is nil (database not available), the handler responds with HTTP 503
// so the API keeps serving other routes even when the DB is down.
func Events(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), eventsQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		events := make([]Event, 0, 50)
		for rows.Next() {
			var e Event
			if err := rows.Scan(
				&e.ID,
				&e.EventID,
				&e.Source,
				&e.EventType,
				&e.Magnitude,
				&e.Latitude,
				&e.Longitude,
				&e.Place,
				&e.EventTime,
				&e.URL,
				&e.Severity,
				&e.CreatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			events = append(events, e)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": events,
			"meta": gin.H{
				"count": len(events),
				"limit": 50,
			},
		})
	}
}

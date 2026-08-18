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
	Severity  *string   `json:"severity"`
	CreatedAt time.Time `json:"created_at"`
}

// eventsQuery returns per-type capped events via UNION ALL so no single
// event type can crowd out others. Limits: earthquake 50, wildfire 200,
// flood 30, volcano 30 — total max 310 rows.
//
// The feed itself is all-time curated; the monitoring window total (72h)
// is reported separately via windowTotalQuery so clients can show the
// real activity number instead of the curated cap.
var eventsQuery = `
WITH production_events AS (
  SELECT id, event_id, source, event_type, magnitude, latitude, longitude,
         place, event_time, url, severity, created_at
  FROM events
  WHERE ` + productionEventSQLPredicate("source", "event_id") + `
),
earthquakes AS (
  SELECT * FROM production_events WHERE event_type = 'earthquake'
  ORDER BY event_time DESC NULLS LAST LIMIT 50
),
wildfires AS (
  SELECT * FROM production_events WHERE event_type = 'wildfire'
  ORDER BY event_time DESC NULLS LAST LIMIT 200
),
floods AS (
  SELECT * FROM production_events WHERE event_type = 'flood'
  ORDER BY event_time DESC NULLS LAST LIMIT 30
),
volcanoes AS (
  SELECT * FROM production_events WHERE event_type = 'volcano'
  ORDER BY event_time DESC NULLS LAST LIMIT 30
)
SELECT * FROM earthquakes
UNION ALL
SELECT * FROM wildfires
UNION ALL
SELECT * FROM floods
UNION ALL
SELECT * FROM volcanoes
ORDER BY event_time DESC NULLS LAST
`

// windowTotalQuery counts real production events inside the monitoring
// window (72 hours) regardless of the curated per-type caps.
const eventsWindow = 72 * time.Hour

var windowTotalQuery = `
SELECT count(*)
FROM events
WHERE event_time > now() - $1::interval
  AND ` + productionEventSQLPredicate("source", "event_id") + `
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

		events := make([]Event, 0, 310)
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
			if isNonProductionEvent(e.Source, e.EventID) {
				continue
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

		// Total aktivitas nyata dalam window monitor (72 jam) — dipisah dari
		// count feed terkurasi agar klien bisa menampilkan keduanya.
		windowTotal := len(events)
		var scanned int
		if err := db.QueryRowContext(c.Request.Context(), windowTotalQuery, eventsWindow.String()).Scan(&scanned); err == nil {
			windowTotal = scanned
		}

		c.JSON(http.StatusOK, gin.H{
			"data": events,
			"meta": gin.H{
				"count":        len(events),
				"limit":        310,
				"window_hours": 72,
				"window_total": windowTotal,
			},
		})
	}
}

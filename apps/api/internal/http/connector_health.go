package http

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// connectorThresholds maps each connector name to its staleness threshold in
// seconds. Threshold = 2× the scheduler's poll interval for that source type.
var connectorThresholds = map[string]int{
	// Hazard — IngestScheduler every 5 min (300s) × 2
	"bmkg":       600,
	"bmkg_cap":   600,
	"usgs":       600,
	"gdacs_fl":   600,
	"gdacs_vo":   600,
	"nasa_firms": 600,
	// News — NewsScheduler every 15 min (900s) × 2
	"antara":    1800,
	"detik":     1800,
	"cnn":       1800,
	"tempo":     1800,
	"republika": 1800,
	"sindo":     1800,
	"okezone":   1800,
	// Vessel & Aircraft — AssetScheduler every 60s × 2
	"aisstream":    120,
	"vesselfinder": 120,
	"opensky":      120,
}

// ConnectorHealth is one row in the /api/v1/health/connectors response.
type ConnectorHealth struct {
	Name             string     `json:"name"`
	Status           string     `json:"status"` // "ok" | "stale" | "error"
	LastPolledAt     *time.Time `json:"last_polled_at"`
	ItemsFetched     int        `json:"items_fetched"`
	ErrorMessage     *string    `json:"error_message"`
	ThresholdSeconds int        `json:"threshold_seconds"`
	UpdatedAt        *time.Time `json:"updated_at"`
}

// ConnectorHealthHandler returns a gin.HandlerFunc for GET /api/v1/health/connectors.
// Status is computed at request time: "error" if error_message is set,
// "stale" if last_polled_at is null or older than threshold_seconds, else "ok".
// All known connectors always appear in the response even if the DB row
// does not exist yet (they will show as status "stale").
func ConnectorHealthHandler(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		const query = `
			SELECT name, last_polled_at, items_fetched, error_message, updated_at
			FROM connector_health
		`
		rows, err := db.QueryContext(c.Request.Context(), query)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		type dbRow struct {
			lastPolledAt *time.Time
			itemsFetched int
			errorMessage *string
			updatedAt    *time.Time
		}
		dbRows := make(map[string]dbRow)
		for rows.Next() {
			var name string
			var r dbRow
			if err := rows.Scan(
				&name,
				&r.lastPolledAt,
				&r.itemsFetched,
				&r.errorMessage,
				&r.updatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			dbRows[name] = r
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		now := time.Now().UTC()
		result := make([]ConnectorHealth, 0, len(connectorThresholds))

		for name, threshold := range connectorThresholds {
			ch := ConnectorHealth{
				Name:             name,
				ThresholdSeconds: threshold,
			}

			row, exists := dbRows[name]
			if !exists {
				ch.Status = "stale"
				result = append(result, ch)
				continue
			}

			ch.LastPolledAt = row.lastPolledAt
			ch.ItemsFetched = row.itemsFetched
			ch.ErrorMessage = row.errorMessage
			ch.UpdatedAt = row.updatedAt

			switch {
			case row.errorMessage != nil:
				ch.Status = "error"
			case row.lastPolledAt == nil:
				ch.Status = "stale"
			case now.Sub(*row.lastPolledAt) > time.Duration(threshold)*time.Second:
				ch.Status = "stale"
			default:
				ch.Status = "ok"
			}

			result = append(result, ch)
		}

		c.JSON(http.StatusOK, gin.H{
			"data": result,
			"meta": gin.H{"count": len(result)},
		})
	}
}

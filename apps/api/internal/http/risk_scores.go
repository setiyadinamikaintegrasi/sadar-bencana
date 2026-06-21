package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// RiskScore mirrors a row of the risk_scores table (for entity_type = 'event')
// joined with its related event when one exists.
type RiskScore struct {
	EntityID     string          `json:"entity_id"`
	Score        float64         `json:"score"`
	Factors      json.RawMessage `json:"factors"`
	CalculatedAt time.Time       `json:"calculated_at"`
	Place        *string         `json:"place"`
	Magnitude    *float64        `json:"magnitude"`
	Source       *string         `json:"source"`
}

// riskScoresQuery selects the top 50 event risk scores joined with their
// matching event rows, ordered by score descending. The LEFT JOIN keeps rows
// whose entity_id has no corresponding event.
const riskScoresQuery = `
SELECT rs.entity_id, rs.score, rs.factors, rs.calculated_at,
       e.place, e.magnitude, e.source
FROM risk_scores rs
LEFT JOIN events e ON rs.entity_id = e.event_id
WHERE rs.entity_type = 'event'
ORDER BY rs.score DESC
LIMIT 50
`

// RiskScores returns a gin.HandlerFunc that lists the top event risk scores.
// If db is nil (database not available), the handler responds with HTTP 503
// so the API keeps serving other routes even when the DB is down.
func RiskScores(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_unavailable",
				"message": "the database is not configured",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), riskScoresQuery)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		scores := make([]RiskScore, 0, 50)
		for rows.Next() {
			var rs RiskScore
			// factors is a nullable JSONB column: scan the raw bytes first so
			// we can represent NULL as a JSON null and valid JSON verbatim.
			var factors []byte
			var place, source sql.NullString
			var magnitude sql.NullFloat64
			if err := rows.Scan(
				&rs.EntityID,
				&rs.Score,
				&factors,
				&rs.CalculatedAt,
				&place,
				&magnitude,
				&source,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			rs.Factors = json.RawMessage(factors)
			rs.Place = nullStringPtr(place)
			rs.Magnitude = nullFloat64Ptr(magnitude)
			rs.Source = nullStringPtr(source)
			scores = append(scores, rs)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": scores,
			"meta": gin.H{
				"count": len(scores),
				"limit": 50,
			},
		})
	}
}

// nullStringPtr converts a sql.NullString into a *string, returning nil when
// the value is NULL so it serializes to a JSON null.
func nullStringPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.String
}

// nullFloat64Ptr converts a sql.NullFloat64 into a *float64, returning nil
// when the value is NULL so it serializes to a JSON null.
func nullFloat64Ptr(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	return &n.Float64
}

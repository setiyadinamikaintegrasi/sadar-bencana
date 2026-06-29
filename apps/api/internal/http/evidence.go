package http

import (
	"database/sql"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var uuidPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`,
)

type EventEvidence struct {
	ID                 string     `json:"id"`
	EventID            *string    `json:"event_id"`
	PerilType          *string    `json:"peril_type"`
	RelationType       string     `json:"relation_type"`
	Confidence         float64    `json:"confidence"`
	FreshnessExpiresAt *time.Time `json:"freshness_expires_at"`
	CreatedAt          time.Time  `json:"created_at"`
	SourceRecordID     string     `json:"source_record_id"`
	SourceName         string     `json:"source_name"`
	SourceNativeID     string     `json:"source_native_id"`
	SourceType         string     `json:"source_type"`
	SourceURL          *string    `json:"source_url"`
	Attribution        *string    `json:"attribution"`
	ObservedAt         *time.Time `json:"observed_at"`
	PublishedAt        *time.Time `json:"published_at"`
	IngestedAt         time.Time  `json:"ingested_at"`
}

const eventEvidenceQuery = `
SELECT ee.id, ee.event_id, ee.peril_type, ee.relation_type, ee.confidence,
       ee.freshness_expires_at, ee.created_at,
       sr.id, sr.source_name, sr.source_record_id, sr.source_type,
       sr.source_url, sr.attribution, sr.observed_at, sr.published_at,
       sr.ingested_at
FROM event_evidence ee
JOIN source_records sr ON sr.id = ee.source_record_id
WHERE ee.event_id = $1::uuid
ORDER BY ee.created_at DESC
LIMIT 200
`

// EventEvidenceList exposes source provenance without returning raw source payloads.
func EventEvidenceList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		eventID := strings.TrimSpace(c.Param("id"))
		if !uuidPattern.MatchString(eventID) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_event_id",
				"message": "event id must be a UUID",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), eventEvidenceQuery, eventID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		evidence := make([]EventEvidence, 0)
		for rows.Next() {
			var item EventEvidence
			var linkedEventID, perilType, sourceURL, attribution sql.NullString
			var freshness, observedAt, publishedAt sql.NullTime
			if err := rows.Scan(
				&item.ID,
				&linkedEventID,
				&perilType,
				&item.RelationType,
				&item.Confidence,
				&freshness,
				&item.CreatedAt,
				&item.SourceRecordID,
				&item.SourceName,
				&item.SourceNativeID,
				&item.SourceType,
				&sourceURL,
				&attribution,
				&observedAt,
				&publishedAt,
				&item.IngestedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			item.EventID = nullStringPtr(linkedEventID)
			item.PerilType = nullStringPtr(perilType)
			item.SourceURL = nullStringPtr(sourceURL)
			item.Attribution = nullStringPtr(attribution)
			if freshness.Valid {
				item.FreshnessExpiresAt = &freshness.Time
			}
			if observedAt.Valid {
				item.ObservedAt = &observedAt.Time
			}
			if publishedAt.Valid {
				item.PublishedAt = &publishedAt.Time
			}
			evidence = append(evidence, item)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "rows_iteration_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": evidence,
			"meta": gin.H{
				"count":    len(evidence),
				"event_id": eventID,
			},
		})
	}
}

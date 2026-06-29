package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type CorrelationReview struct {
	ID               string          `json:"id"`
	CorrelationID    string          `json:"correlation_id"`
	Status           string          `json:"status"`
	Reviewer         *string         `json:"reviewer"`
	ReviewNotes      *string         `json:"review_notes"`
	CreatedAt        time.Time       `json:"created_at"`
	ReviewedAt       *time.Time      `json:"reviewed_at"`
	LeftEventID      string          `json:"left_event_id"`
	RightEventID     string          `json:"right_event_id"`
	PerilType        string          `json:"peril_type"`
	DistanceKM       *float64        `json:"distance_km"`
	TimeDeltaSeconds *float64        `json:"time_delta_seconds"`
	Confidence       float64         `json:"confidence"`
	Reasons          json.RawMessage `json:"reasons"`
	RuleVersion      string          `json:"rule_version"`
}

const correlationReviewsQuery = `
SELECT cr.id, cr.correlation_id, cr.status, cr.reviewer, cr.review_notes,
       cr.created_at, cr.reviewed_at, ec.left_event_id, ec.right_event_id,
       ec.peril_type, ec.distance_km, ec.time_delta_seconds, ec.confidence,
       ec.reasons, ec.rule_version
FROM correlation_reviews cr
JOIN event_correlations ec ON ec.id = cr.correlation_id
WHERE ($1 = '' OR cr.status = $1)
ORDER BY cr.created_at DESC
LIMIT 200
`

var correlationReviewStatuses = map[string]bool{
	"pending":  true,
	"approved": true,
	"rejected": true,
}

// CorrelationReviewQueue exposes ambiguous correlation decisions for analysts.
func CorrelationReviewQueue(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		status := strings.ToLower(strings.TrimSpace(c.DefaultQuery("status", "pending")))
		if status != "" && !correlationReviewStatuses[status] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_status",
				"message": "status must be pending, approved, rejected, or empty",
			})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), correlationReviewsQuery, status)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()

		items := make([]CorrelationReview, 0)
		for rows.Next() {
			var item CorrelationReview
			var reviewer, notes sql.NullString
			var reviewedAt sql.NullTime
			var distance, delta sql.NullFloat64
			var reasons []byte
			if err := rows.Scan(
				&item.ID, &item.CorrelationID, &item.Status, &reviewer, &notes,
				&item.CreatedAt, &reviewedAt, &item.LeftEventID, &item.RightEventID,
				&item.PerilType, &distance, &delta, &item.Confidence, &reasons,
				&item.RuleVersion,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			item.Reviewer = nullStringPtr(reviewer)
			item.ReviewNotes = nullStringPtr(notes)
			if reviewedAt.Valid {
				item.ReviewedAt = &reviewedAt.Time
			}
			if distance.Valid {
				item.DistanceKM = &distance.Float64
			}
			if delta.Valid {
				item.TimeDeltaSeconds = &delta.Float64
			}
			item.Reasons = reasons
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items, "meta": gin.H{"count": len(items), "status": status}})
	}
}

type MergeAuditOperation struct {
	ID                  string          `json:"id"`
	OperationType       string          `json:"operation_type"`
	CanonicalEventID    string          `json:"canonical_event_id"`
	MemberEventID       string          `json:"member_event_id"`
	CorrelationID       *string         `json:"correlation_id"`
	ReversesOperationID *string         `json:"reverses_operation_id"`
	Actor               string          `json:"actor"`
	Reason              string          `json:"reason"`
	Snapshot            json.RawMessage `json:"snapshot"`
	CreatedAt           time.Time       `json:"created_at"`
}

const eventMergeAuditQuery = `
SELECT id, operation_type, canonical_event_id, member_event_id, correlation_id,
       reverses_operation_id, actor, reason, snapshot, created_at
FROM event_merge_operations
WHERE canonical_event_id = $1::uuid OR member_event_id = $1::uuid
ORDER BY created_at DESC
LIMIT 200
`

// EventCorrelationAudit returns the immutable merge/split history for an event.
func EventCorrelationAudit(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		eventID := strings.TrimSpace(c.Param("id"))
		if !uuidPattern.MatchString(eventID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_event_id", "message": "event id must be a UUID"})
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), eventMergeAuditQuery, eventID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()

		items := make([]MergeAuditOperation, 0)
		for rows.Next() {
			var item MergeAuditOperation
			var correlationID, reversesID sql.NullString
			var snapshot []byte
			if err := rows.Scan(
				&item.ID, &item.OperationType, &item.CanonicalEventID,
				&item.MemberEventID, &correlationID, &reversesID, &item.Actor,
				&item.Reason, &snapshot, &item.CreatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			item.CorrelationID = nullStringPtr(correlationID)
			item.ReversesOperationID = nullStringPtr(reversesID)
			item.Snapshot = snapshot
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items, "meta": gin.H{"count": len(items), "event_id": eventID}})
	}
}

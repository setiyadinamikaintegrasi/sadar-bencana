package http

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type AlertActionCard struct {
	AlertID         string          `json:"alert_id"`
	WhatHappened    string          `json:"what_happened"`
	WhyReceived     string          `json:"why_received"`
	PerilType       string          `json:"peril_type"`
	Source          *string         `json:"source"`
	ConfidenceClass string          `json:"confidence_class"`
	LastUpdate      time.Time       `json:"last_update"`
	EffectiveAt     *time.Time      `json:"effective_at"`
	ExpiresAt       *time.Time      `json:"expires_at"`
	GuidanceVersion string          `json:"guidance_version"`
	Guidance        json.RawMessage `json:"guidance"`
	GuidanceSource  *string         `json:"guidance_source"`
}

const alertActionCardQuery = `
SELECT a.id, COALESCE(a.message, 'Informasi kejadian terpantau'),
       'Alert ini cocok dengan aturan monitoring dan area yang Anda pantau.',
       COALESCE(e.event_type, a.alert_type), e.source, a.confidence_class,
       a.created_at, g.content_version, g.content, g.source_url
FROM alerts a
LEFT JOIN events e ON e.id = a.event_id
JOIN ews_safety_guidance g
  ON g.peril_type = COALESCE(e.event_type, a.alert_type)
 AND g.language_code = 'id' AND g.is_active = TRUE
WHERE a.id = $1::uuid
LIMIT 1
`

// AlertActionCardGet returns locally curated, versioned safety guidance.
func AlertActionCardGet(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		alertID := strings.TrimSpace(c.Param("id"))
		if !uuidPattern.MatchString(alertID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_alert_id"})
			return
		}
		var card AlertActionCard
		var source, guidanceSource sql.NullString
		var guidance []byte
		err := db.QueryRowContext(c.Request.Context(), alertActionCardQuery, alertID).Scan(
			&card.AlertID, &card.WhatHappened, &card.WhyReceived, &card.PerilType,
			&source, &card.ConfidenceClass, &card.LastUpdate,
			&card.GuidanceVersion, &guidance, &guidanceSource,
		)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "action_card_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		card.Source = nullStringPtr(source)
		card.GuidanceSource = nullStringPtr(guidanceSource)
		card.Guidance = guidance
		c.JSON(http.StatusOK, gin.H{"data": card})
	}
}

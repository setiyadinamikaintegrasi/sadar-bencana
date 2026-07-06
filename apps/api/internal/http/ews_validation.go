package http

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var ewsChannels = map[string]struct{}{
	"telegram": {},
	"email":    {},
}

var ewsSeverities = map[string]struct{}{
	"Moderate": {},
	"High":     {},
	"Critical": {},
}

var ewsAlertTypes = map[string]struct{}{
	"earthquake": {},
	"flood":      {},
	"volcano":    {},
	"wildfire":   {},
	"risk_score": {},
}

func validEWSTimezone(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	_, err := time.LoadLocation(value)
	return err == nil
}

func validateEWSPreference(
	c *gin.Context,
	db *sql.DB,
	subscriberID string,
	channel string,
	minSeverity *string,
	alertTypes []string,
	quietStart *string,
	quietEnd *string,
	enabled *bool,
) bool {
	channel = strings.TrimSpace(channel)
	if _, ok := ewsChannels[channel]; !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported_channel"})
		return false
	}
	if minSeverity != nil {
		if _, ok := ewsSeverities[*minSeverity]; !ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_min_severity"})
			return false
		}
	}
	for _, alertType := range alertTypes {
		if _, ok := ewsAlertTypes[alertType]; !ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error": "invalid_alert_type", "value": alertType,
			})
			return false
		}
	}
	if (quietStart == nil) != (quietEnd == nil) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "quiet_hours_must_be_paired"})
		return false
	}
	if quietStart != nil {
		if _, err := time.Parse("15:04", *quietStart); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_quiet_hours_start"})
			return false
		}
		if _, err := time.Parse("15:04", *quietEnd); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_quiet_hours_end"})
			return false
		}
	}
	if enabled == nil || !*enabled {
		return true
	}

	var hasZone bool
	var hasRecipient bool
	err := db.QueryRowContext(
		c.Request.Context(),
		`SELECT
		   EXISTS (
		     SELECT 1 FROM ews_watch_zones
		     WHERE subscriber_id = $1 AND is_active = TRUE
		   ),
		   CASE
		     WHEN $2 = 'telegram' THEN telegram_chat_id IS NOT NULL
		     WHEN $2 = 'email' THEN email IS NOT NULL AND email <> ''
		     ELSE FALSE
		   END
		 FROM ews_subscribers WHERE id = $1`,
		subscriberID,
		channel,
	).Scan(&hasZone, &hasRecipient)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscriber_not_found"})
		return false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
		return false
	}
	if !hasZone {
		c.JSON(http.StatusConflict, gin.H{"error": "watch_zone_required"})
		return false
	}
	if !hasRecipient {
		c.JSON(http.StatusConflict, gin.H{"error": "channel_recipient_required"})
		return false
	}
	return true
}

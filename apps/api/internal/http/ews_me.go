package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// resolveSubscriber ensures the authenticated user has an ews_subscriber row
// and returns its id. Links by auth_user_id, claiming a pre-existing row by
// email if one exists (e.g. an admin-seeded subscriber), else inserts a new one.
func resolveSubscriber(c *gin.Context, db *sql.DB) (string, bool) {
	authUserID := AuthUserID(c)
	email := AuthEmail(c)

	var id string
	// 1. Already linked.
	err := db.QueryRowContext(c.Request.Context(),
		`SELECT id FROM ews_subscribers WHERE auth_user_id = $1`, authUserID).Scan(&id)
	if err == nil {
		return id, true
	}
	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provision_failed", "message": err.Error()})
		return "", false
	}

	// 2. Claim an existing unlinked row that matches the email.
	if email != "" {
		err = db.QueryRowContext(c.Request.Context(),
			`UPDATE ews_subscribers SET auth_user_id = $1, updated_at = now()
			 WHERE email = $2 AND auth_user_id IS NULL RETURNING id`,
			authUserID, email).Scan(&id)
		if err == nil {
			return id, true
		}
		if err != sql.ErrNoRows {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "provision_failed", "message": err.Error()})
			return "", false
		}
	}

	// 3. Insert a fresh subscriber for this auth user.
	name := email
	if name == "" {
		name = "user"
	}
	var emailArg any
	if email != "" {
		emailArg = email
	}
	err = db.QueryRowContext(c.Request.Context(),
		`INSERT INTO ews_subscribers (auth_user_id, name, email)
		 VALUES ($1, $2, $3) RETURNING id`,
		authUserID, name, emailArg).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provision_failed", "message": err.Error()})
		return "", false
	}
	return id, true
}

// ── Profile ─────────────────────────────────────────────────

// EWSMeProfile returns the authenticated subscriber's profile.
func EWSMeProfile(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		var s EWSSubscriber
		var email, phone sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(c.Request.Context(),
			`SELECT id, name, email, phone_whatsapp, telegram_chat_id, role, is_active, created_at
			 FROM ews_subscribers WHERE id = $1`, subID).
			Scan(&s.ID, &s.Name, &email, &phone, &chatID, &s.Role, &s.IsActive, &s.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		s.Email = nullStringPtr(email)
		s.PhoneWhatsApp = nullStringPtr(phone)
		s.TelegramChatID = nullInt64Ptr(chatID)
		c.JSON(http.StatusOK, gin.H{"data": s})
	}
}

type ewsMeProfileBody struct {
	Name           *string `json:"name"`
	PhoneWhatsApp  *string `json:"phone_whatsapp"`
	TelegramChatID *int64  `json:"telegram_chat_id"`
}

// EWSMeProfileUpdate updates the authenticated subscriber's name + contact handles.
func EWSMeProfileUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		var body ewsMeProfileBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		var s EWSSubscriber
		var email, phone sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(c.Request.Context(),
			`UPDATE ews_subscribers SET
			   name = COALESCE($2, name),
			   phone_whatsapp = COALESCE($3, phone_whatsapp),
			   telegram_chat_id = COALESCE($4, telegram_chat_id),
			   updated_at = now()
			 WHERE id = $1
			 RETURNING id, name, email, phone_whatsapp, telegram_chat_id, role, is_active, created_at`,
			subID, body.Name, body.PhoneWhatsApp, body.TelegramChatID).
			Scan(&s.ID, &s.Name, &email, &phone, &chatID, &s.Role, &s.IsActive, &s.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		s.Email = nullStringPtr(email)
		s.PhoneWhatsApp = nullStringPtr(phone)
		s.TelegramChatID = nullInt64Ptr(chatID)
		c.JSON(http.StatusOK, gin.H{"data": s})
	}
}

// ── Watch zones (scoped to me) ──────────────────────────────

// EWSMeWatchZonesList lists the authenticated subscriber's watch zones.
func EWSMeWatchZonesList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT id, subscriber_id, label, latitude, longitude, radius_km,
			        array_to_string(peril_types, ','), min_magnitude, thresholds, is_active
			 FROM ews_watch_zones WHERE subscriber_id = $1 ORDER BY created_at DESC`, subID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		zones := make([]EWSWatchZone, 0)
		for rows.Next() {
			var z EWSWatchZone
			if err := scanEWSWatchZone(rows, &z); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			zones = append(zones, z)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": zones, "meta": gin.H{"count": len(zones)}})
	}
}

type ewsMeZoneBody struct {
	Label        string              `json:"label"`
	Latitude     *float64            `json:"latitude"`
	Longitude    *float64            `json:"longitude"`
	RadiusKm     *float64            `json:"radius_km"`
	PerilTypes   []string            `json:"peril_types"`
	MinMagnitude *float64            `json:"min_magnitude"`
	Thresholds   *EWSPerilThresholds `json:"thresholds"`
}

// EWSMeWatchZoneCreate creates a watch zone owned by the authenticated subscriber.
func EWSMeWatchZoneCreate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		var body ewsMeZoneBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if strings.TrimSpace(body.Label) == "" || body.Latitude == nil || body.Longitude == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_fields", "message": "label, latitude, longitude required"})
			return
		}
		if err := validatePerilThresholds(body.Thresholds); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_thresholds", "message": err.Error()})
			return
		}
		thresholdsArg, err := thresholdsJSONArg(body.Thresholds)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_thresholds", "message": err.Error()})
			return
		}
		var z EWSWatchZone
		err = scanEWSWatchZone(db.QueryRowContext(c.Request.Context(),
			`INSERT INTO ews_watch_zones
			   (subscriber_id, label, latitude, longitude, radius_km, peril_types,
			    min_magnitude, thresholds)
			 VALUES ($1, $2, $3, $4, COALESCE($5, 50), $6::text[], COALESCE($7, 5.0),
			         COALESCE($8::jsonb, '{}'))
			 RETURNING id, subscriber_id, label, latitude, longitude, radius_km,
			           array_to_string(peril_types, ','), min_magnitude, thresholds, is_active`,
			subID, body.Label, body.Latitude, body.Longitude, body.RadiusKm,
			toPGTextArray(body.PerilTypes), body.MinMagnitude, thresholdsArg), &z)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": z})
	}
}

type ewsMeZoneUpdateBody struct {
	Label        *string             `json:"label"`
	Latitude     *float64            `json:"latitude"`
	Longitude    *float64            `json:"longitude"`
	RadiusKm     *float64            `json:"radius_km"`
	PerilTypes   []string            `json:"peril_types"`
	MinMagnitude *float64            `json:"min_magnitude"`
	Thresholds   *EWSPerilThresholds `json:"thresholds"`
	IsActive     *bool               `json:"is_active"`
}

// EWSMeWatchZoneUpdate updates a zone only if it belongs to the authenticated subscriber.
func EWSMeWatchZoneUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		var body ewsMeZoneUpdateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		var perilArg any
		if body.PerilTypes != nil {
			perilArg = toPGTextArray(body.PerilTypes)
		}
		if err := validatePerilThresholds(body.Thresholds); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_thresholds", "message": err.Error()})
			return
		}
		thresholdsArg, err := thresholdsJSONArg(body.Thresholds)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_thresholds", "message": err.Error()})
			return
		}
		var z EWSWatchZone
		err = scanEWSWatchZone(db.QueryRowContext(c.Request.Context(),
			`UPDATE ews_watch_zones SET
			   label = COALESCE($3, label),
			   latitude = COALESCE($4, latitude),
			   longitude = COALESCE($5, longitude),
			   radius_km = COALESCE($6, radius_km),
			   peril_types = COALESCE($7::text[], peril_types),
			   min_magnitude = COALESCE($8, min_magnitude),
			   thresholds = COALESCE($9::jsonb, thresholds),
			   is_active = COALESCE($10, is_active),
			   updated_at = now()
			 WHERE id = $1 AND subscriber_id = $2
			 RETURNING id, subscriber_id, label, latitude, longitude, radius_km,
			           array_to_string(peril_types, ','), min_magnitude, thresholds, is_active`,
			id, subID, body.Label, body.Latitude, body.Longitude, body.RadiusKm,
			perilArg, body.MinMagnitude, thresholdsArg, body.IsActive), &z)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "watch_zone_not_found", "message": "no zone for this user"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": z})
	}
}

// EWSMeWatchZoneDelete deletes a zone only if it belongs to the authenticated subscriber.
func EWSMeWatchZoneDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		var deletedID string
		err := db.QueryRowContext(c.Request.Context(),
			`DELETE FROM ews_watch_zones WHERE id = $1 AND subscriber_id = $2 RETURNING id`,
			id, subID).Scan(&deletedID)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "watch_zone_not_found", "message": "no zone for this user"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": deletedID}})
	}
}

// ── Preferences (scoped to me) ──────────────────────────────

// EWSMePrefsGet lists the authenticated subscriber's notification preferences.
func EWSMePrefsGet(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT channel, min_severity, array_to_string(alert_types, ','),
			        to_char(quiet_hours_start, 'HH24:MI'), to_char(quiet_hours_end, 'HH24:MI'), is_enabled
			 FROM ews_notification_prefs WHERE subscriber_id = $1 ORDER BY channel`, subID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		prefs := make([]gin.H, 0)
		for rows.Next() {
			var channel, minSeverity, alertTypes string
			var qs, qe sql.NullString
			var enabled bool
			if err := rows.Scan(&channel, &minSeverity, &alertTypes, &qs, &qe, &enabled); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			prefs = append(prefs, gin.H{
				"channel": channel, "min_severity": minSeverity,
				"alert_types":       parsePGTextArray(alertTypes),
				"quiet_hours_start": nullStringPtr(qs), "quiet_hours_end": nullStringPtr(qe),
				"is_enabled": enabled,
			})
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": prefs, "meta": gin.H{"count": len(prefs)}})
	}
}

type ewsMePrefBody struct {
	Channel         string   `json:"channel"`
	MinSeverity     *string  `json:"min_severity"`
	AlertTypes      []string `json:"alert_types"`
	QuietHoursStart *string  `json:"quiet_hours_start"`
	QuietHoursEnd   *string  `json:"quiet_hours_end"`
	IsEnabled       *bool    `json:"is_enabled"`
}

// EWSMePrefsUpdate upserts a single channel preference for the authenticated subscriber.
func EWSMePrefsUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		var body ewsMePrefBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": err.Error()})
			return
		}
		if strings.TrimSpace(body.Channel) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing_channel", "message": "channel required"})
			return
		}
		var channel, minSeverity, alertTypes string
		var qs, qe sql.NullString
		var enabled bool
		err := db.QueryRowContext(c.Request.Context(),
			`INSERT INTO ews_notification_prefs
			   (subscriber_id, channel, min_severity, alert_types, quiet_hours_start, quiet_hours_end, is_enabled)
			 VALUES ($1, $2, COALESCE($3,'High'), $4::text[], $5::time, $6::time, COALESCE($7,TRUE))
			 ON CONFLICT (subscriber_id, channel) DO UPDATE SET
			   min_severity = COALESCE(EXCLUDED.min_severity, ews_notification_prefs.min_severity),
			   alert_types = EXCLUDED.alert_types,
			   quiet_hours_start = EXCLUDED.quiet_hours_start,
			   quiet_hours_end = EXCLUDED.quiet_hours_end,
			   is_enabled = EXCLUDED.is_enabled
			 RETURNING channel, min_severity, array_to_string(alert_types, ','),
			           to_char(quiet_hours_start,'HH24:MI'), to_char(quiet_hours_end,'HH24:MI'), is_enabled`,
			subID, body.Channel, body.MinSeverity, toPGTextArray(body.AlertTypes),
			body.QuietHoursStart, body.QuietHoursEnd, body.IsEnabled).
			Scan(&channel, &minSeverity, &alertTypes, &qs, &qe, &enabled)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"channel": channel, "min_severity": minSeverity,
			"alert_types":       parsePGTextArray(alertTypes),
			"quiet_hours_start": nullStringPtr(qs), "quiet_hours_end": nullStringPtr(qe),
			"is_enabled": enabled,
		}})
	}
}

// ── Notifications (read-only, mine) ─────────────────────────

// EWSMeNotifications lists the delivery log addressed to the authenticated subscriber.
func EWSMeNotifications(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		limit := 100
		if v := strings.TrimSpace(c.Query("limit")); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		rows, err := db.QueryContext(c.Request.Context(),
			`SELECT id, alert_id, channel, status, error_message, sent_at, created_at
			 FROM ews_notification_log WHERE subscriber_id = $1
			 ORDER BY created_at DESC LIMIT $2`, subID, limit)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		entries := make([]gin.H, 0)
		for rows.Next() {
			var id, channel, status string
			var alertID, errMsg sql.NullString
			var sentAt sql.NullTime
			var createdAt time.Time
			if err := rows.Scan(&id, &alertID, &channel, &status, &errMsg, &sentAt, &createdAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed", "message": err.Error()})
				return
			}
			var sentAtPtr *time.Time
			if sentAt.Valid {
				sentAtPtr = &sentAt.Time
			}
			entries = append(entries, gin.H{
				"id": id, "alert_id": nullStringPtr(alertID), "channel": channel,
				"status": status, "error_message": nullStringPtr(errMsg),
				"sent_at": sentAtPtr, "created_at": createdAt,
			})
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries, "meta": gin.H{"count": len(entries)}})
	}
}

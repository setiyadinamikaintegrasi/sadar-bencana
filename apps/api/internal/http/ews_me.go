package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
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
		var email sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(c.Request.Context(),
			`SELECT id, name, email, telegram_chat_id, timezone, role, is_active, created_at
			 FROM ews_subscribers WHERE id = $1`, subID).
			Scan(&s.ID, &s.Name, &email, &chatID, &s.Timezone, &s.Role, &s.IsActive, &s.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		s.Email = nullStringPtr(email)
		s.TelegramChatID = nullInt64Ptr(chatID)
		c.JSON(http.StatusOK, gin.H{"data": s})
	}
}

type ewsMeProfileBody struct {
	Name           *string       `json:"name"`
	TelegramChatID optionalInt64 `json:"telegram_chat_id"`
	Timezone       *string       `json:"timezone"`
}

type optionalInt64 struct {
	Set   bool
	Value *int64
}

func (value *optionalInt64) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(data, []byte("null")) {
		value.Value = nil
		return nil
	}
	var parsed int64
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	value.Value = &parsed
	return nil
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
		if body.TelegramChatID.Set && body.TelegramChatID.Value != nil &&
			*body.TelegramChatID.Value == 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_telegram_chat_id"})
			return
		}
		if body.Timezone != nil {
			if _, err := time.LoadLocation(strings.TrimSpace(*body.Timezone)); err != nil {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_timezone"})
				return
			}
		}
		telegramChanged := false
		if body.TelegramChatID.Set {
			var currentChatID sql.NullInt64
			if err := db.QueryRowContext(
				c.Request.Context(),
				`SELECT telegram_chat_id FROM ews_subscribers WHERE id = $1`,
				subID,
			).Scan(&currentChatID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
				return
			}
			if body.TelegramChatID.Value == nil {
				telegramChanged = currentChatID.Valid
			} else {
				telegramChanged = !currentChatID.Valid ||
					currentChatID.Int64 != *body.TelegramChatID.Value
			}
		}
		var s EWSSubscriber
		var email sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(c.Request.Context(),
			`UPDATE ews_subscribers SET
			   name = COALESCE($2, name),
			   telegram_chat_id = CASE WHEN $3 THEN $4 ELSE telegram_chat_id END,
			   timezone = COALESCE($5, timezone),
			   updated_at = now()
			 WHERE id = $1
			 RETURNING id, name, email, telegram_chat_id, timezone, role, is_active, created_at`,
			subID, body.Name, body.TelegramChatID.Set, body.TelegramChatID.Value, body.Timezone).
			Scan(&s.ID, &s.Name, &email, &chatID, &s.Timezone, &s.Role, &s.IsActive, &s.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		if telegramChanged {
			if _, err := db.ExecContext(
				c.Request.Context(),
				`DELETE FROM ews_channel_verifications
				 WHERE subscriber_id = $1 AND channel = 'telegram'`,
				subID,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "verification_reset_failed"})
				return
			}
		}
		s.Email = nullStringPtr(email)
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
		if !validateEWSPreference(
			c, db, subID, body.Channel, body.MinSeverity, body.AlertTypes,
			body.QuietHoursStart, body.QuietHoursEnd, body.IsEnabled,
		) {
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
			`SELECT l.id, l.alert_id, l.channel, l.status, l.error_message, l.sent_at,
			        l.created_at, oa.headline, oa.peril_type, l.lifecycle_action, z.label
			 FROM ews_notification_log l
			 LEFT JOIN official_alerts oa ON oa.id = l.official_alert_id
			 LEFT JOIN ews_watch_zones z ON z.id = l.matched_watch_zone_id
			 WHERE l.subscriber_id = $1
			 ORDER BY l.created_at DESC LIMIT $2`, subID, limit)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		entries := make([]gin.H, 0)
		for rows.Next() {
			var id, channel, status string
			var alertID, errMsg, headline, perilType, lifecycleAction, matchedWatchZoneLabel sql.NullString
			var sentAt sql.NullTime
			var createdAt time.Time
			if err := rows.Scan(
				&id, &alertID, &channel, &status, &errMsg, &sentAt, &createdAt,
				&headline, &perilType, &lifecycleAction, &matchedWatchZoneLabel,
			); err != nil {
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
				"headline": nullStringPtr(headline), "peril_type": nullStringPtr(perilType),
				"lifecycle_action":         nullStringPtr(lifecycleAction),
				"matched_watch_zone_label": nullStringPtr(matchedWatchZoneLabel),
			})
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rows_iteration_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries, "meta": gin.H{"count": len(entries)}})
	}
}

// EWSMeNotificationAcknowledge records acknowledgement for one delivery.
func EWSMeNotificationAcknowledge(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		notificationID := strings.TrimSpace(c.Param("id"))
		if !uuidPattern.MatchString(notificationID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_notification_id"})
			return
		}
		var acknowledgedAt time.Time
		err := db.QueryRowContext(
			c.Request.Context(),
			`UPDATE ews_notification_log
			 SET status = 'acknowledged', acknowledged_at = now()
			 WHERE id = $1 AND subscriber_id = $2
			   AND status IN ('sent', 'acknowledged')
			 RETURNING acknowledged_at`,
			notificationID,
			subID,
		).Scan(&acknowledgedAt)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "notification_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"id": notificationID, "status": "acknowledged",
			"acknowledged_at": acknowledgedAt,
		}})
	}
}

package http

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ── Types ────────────────────────────────────────────────────

// EWSSubscriber mirrors a row in ews_subscribers.
type EWSSubscriber struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Email          *string   `json:"email"`
	PhoneWhatsApp  *string   `json:"phone_whatsapp"`
	TelegramChatID *int64    `json:"telegram_chat_id"`
	Role           string    `json:"role"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
}

// EWSWatchZone mirrors a row in ews_watch_zones.
type EWSWatchZone struct {
	ID           string   `json:"id"`
	SubscriberID string   `json:"subscriber_id"`
	Label        string   `json:"label"`
	Latitude     float64  `json:"latitude"`
	Longitude    float64  `json:"longitude"`
	RadiusKm     float64  `json:"radius_km"`
	PerilTypes   []string `json:"peril_types"`
	MinMagnitude float64  `json:"min_magnitude"`
	IsActive     bool     `json:"is_active"`
}

// ── Local helpers ────────────────────────────────────────────

func nullInt64Ptr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

// parsePGTextArray splits a comma-joined string (from array_to_string) into a
// slice, returning an empty (non-nil) slice for empty input.
func parsePGTextArray(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}

// toPGTextArray renders a slice as a PostgreSQL array literal (e.g. {"a","b"})
// suitable for binding to a $N::text[] parameter. Each element is quoted and
// internal quotes/backslashes are escaped.
func toPGTextArray(items []string) string {
	if len(items) == 0 {
		return "{}"
	}
	parts := make([]string, len(items))
	for i, it := range items {
		esc := strings.ReplaceAll(it, `\`, `\\`)
		esc = strings.ReplaceAll(esc, `"`, `\"`)
		parts[i] = `"` + esc + `"`
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func dbUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":   "database_unavailable",
		"message": "the database is not configured",
	})
}

// ── Subscriber CRUD ─────────────────────────────────────────

const ewsSubscribersListQuery = `
SELECT id, name, email, phone_whatsapp, telegram_chat_id, role, is_active, created_at
FROM ews_subscribers
WHERE ($1::boolean IS NULL OR is_active = $1)
ORDER BY created_at DESC
`

// EWSSubscribersList lists subscribers, optionally filtered by is_active.
func EWSSubscribersList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}

		var activeFilter any
		if raw := strings.TrimSpace(c.Query("is_active")); raw != "" {
			switch strings.ToLower(raw) {
			case "true":
				activeFilter = true
			case "false":
				activeFilter = false
			default:
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "invalid_is_active",
					"message": "query parameter 'is_active' must be true or false",
				})
				return
			}
		}

		rows, err := db.QueryContext(c.Request.Context(), ewsSubscribersListQuery, activeFilter)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		subs := make([]EWSSubscriber, 0)
		for rows.Next() {
			var s EWSSubscriber
			var email, phone sql.NullString
			var chatID sql.NullInt64
			if err := rows.Scan(
				&s.ID, &s.Name, &email, &phone, &chatID,
				&s.Role, &s.IsActive, &s.CreatedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			s.Email = nullStringPtr(email)
			s.PhoneWhatsApp = nullStringPtr(phone)
			s.TelegramChatID = nullInt64Ptr(chatID)
			subs = append(subs, s)
		}

		c.JSON(http.StatusOK, gin.H{
			"data": subs,
			"meta": gin.H{"count": len(subs)},
		})
	}
}

type ewsSubscriberCreateBody struct {
	Name           string  `json:"name"`
	Email          *string `json:"email"`
	PhoneWhatsApp  *string `json:"phone_whatsapp"`
	TelegramChatID *int64  `json:"telegram_chat_id"`
	Role           *string `json:"role"`
}

const ewsSubscriberCreateQuery = `
INSERT INTO ews_subscribers (name, email, phone_whatsapp, telegram_chat_id, role)
VALUES ($1, $2, $3, $4, COALESCE($5, 'viewer'))
RETURNING id, name, email, phone_whatsapp, telegram_chat_id, role, is_active, created_at
`

// EWSSubscriberCreate inserts a new subscriber.
func EWSSubscriberCreate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}

		var body ewsSubscriberCreateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_body",
				"message": err.Error(),
			})
			return
		}
		if strings.TrimSpace(body.Name) == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_name",
				"message": "field 'name' is required",
			})
			return
		}

		var s EWSSubscriber
		var email, phone sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(
			c.Request.Context(), ewsSubscriberCreateQuery,
			body.Name, body.Email, body.PhoneWhatsApp, body.TelegramChatID, body.Role,
		).Scan(
			&s.ID, &s.Name, &email, &phone, &chatID,
			&s.Role, &s.IsActive, &s.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		s.Email = nullStringPtr(email)
		s.PhoneWhatsApp = nullStringPtr(phone)
		s.TelegramChatID = nullInt64Ptr(chatID)

		c.JSON(http.StatusCreated, gin.H{"data": s})
	}
}

type ewsSubscriberUpdateBody struct {
	Name           *string `json:"name"`
	Email          *string `json:"email"`
	PhoneWhatsApp  *string `json:"phone_whatsapp"`
	TelegramChatID *int64  `json:"telegram_chat_id"`
	Role           *string `json:"role"`
	IsActive       *bool   `json:"is_active"`
}

const ewsSubscriberUpdateQuery = `
UPDATE ews_subscribers SET
    name             = COALESCE($2, name),
    email            = COALESCE($3, email),
    phone_whatsapp   = COALESCE($4, phone_whatsapp),
    telegram_chat_id = COALESCE($5, telegram_chat_id),
    role             = COALESCE($6, role),
    is_active        = COALESCE($7, is_active),
    updated_at       = now()
WHERE id = $1
RETURNING id, name, email, phone_whatsapp, telegram_chat_id, role, is_active, created_at
`

// EWSSubscriberUpdate updates mutable subscriber fields.
func EWSSubscriberUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var body ewsSubscriberUpdateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_body",
				"message": err.Error(),
			})
			return
		}

		var s EWSSubscriber
		var email, phone sql.NullString
		var chatID sql.NullInt64
		err := db.QueryRowContext(
			c.Request.Context(), ewsSubscriberUpdateQuery,
			id, body.Name, body.Email, body.PhoneWhatsApp,
			body.TelegramChatID, body.Role, body.IsActive,
		).Scan(
			&s.ID, &s.Name, &email, &phone, &chatID,
			&s.Role, &s.IsActive, &s.CreatedAt,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{
					"error":   "subscriber_not_found",
					"message": "no subscriber found for the provided id",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		s.Email = nullStringPtr(email)
		s.PhoneWhatsApp = nullStringPtr(phone)
		s.TelegramChatID = nullInt64Ptr(chatID)

		c.JSON(http.StatusOK, gin.H{"data": s})
	}
}

const ewsSubscriberDeleteQuery = `
UPDATE ews_subscribers SET is_active = FALSE, updated_at = now()
WHERE id = $1
RETURNING id
`

// EWSSubscriberDelete soft-deletes a subscriber (is_active = false).
func EWSSubscriberDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var deletedID string
		err := db.QueryRowContext(c.Request.Context(), ewsSubscriberDeleteQuery, id).Scan(&deletedID)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{
					"error":   "subscriber_not_found",
					"message": "no subscriber found for the provided id",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{"id": deletedID, "is_active": false},
		})
	}
}

// ── Watch Zone CRUD ─────────────────────────────────────────

const ewsWatchZonesListQuery = `
SELECT id, subscriber_id, label, latitude, longitude, radius_km,
       array_to_string(peril_types, ','), min_magnitude, is_active
FROM ews_watch_zones
WHERE subscriber_id = $1
ORDER BY created_at DESC
`

// EWSWatchZonesList lists watch zones for a subscriber.
func EWSWatchZonesList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID := strings.TrimSpace(c.Param("id"))
		if subID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), ewsWatchZonesListQuery, subID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		zones := make([]EWSWatchZone, 0)
		for rows.Next() {
			var z EWSWatchZone
			var perils string
			if err := rows.Scan(
				&z.ID, &z.SubscriberID, &z.Label, &z.Latitude, &z.Longitude,
				&z.RadiusKm, &perils, &z.MinMagnitude, &z.IsActive,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			z.PerilTypes = parsePGTextArray(perils)
			zones = append(zones, z)
		}

		c.JSON(http.StatusOK, gin.H{
			"data": zones,
			"meta": gin.H{"count": len(zones)},
		})
	}
}

type ewsWatchZoneCreateBody struct {
	Label        string   `json:"label"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	RadiusKm     *float64 `json:"radius_km"`
	PerilTypes   []string `json:"peril_types"`
	MinMagnitude *float64 `json:"min_magnitude"`
}

const ewsWatchZoneCreateQuery = `
INSERT INTO ews_watch_zones
    (subscriber_id, label, latitude, longitude, radius_km, peril_types, min_magnitude)
VALUES ($1, $2, $3, $4, COALESCE($5, 50), $6::text[], COALESCE($7, 5.0))
RETURNING id, subscriber_id, label, latitude, longitude, radius_km,
          array_to_string(peril_types, ','), min_magnitude, is_active
`

// EWSWatchZoneCreate creates a watch zone for a subscriber.
func EWSWatchZoneCreate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID := strings.TrimSpace(c.Param("id"))
		if subID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var body ewsWatchZoneCreateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_body",
				"message": err.Error(),
			})
			return
		}
		if strings.TrimSpace(body.Label) == "" || body.Latitude == nil || body.Longitude == nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_fields",
				"message": "fields 'label', 'latitude', 'longitude' are required",
			})
			return
		}

		var z EWSWatchZone
		var perils string
		err := db.QueryRowContext(
			c.Request.Context(), ewsWatchZoneCreateQuery,
			subID, body.Label, body.Latitude, body.Longitude,
			body.RadiusKm, toPGTextArray(body.PerilTypes), body.MinMagnitude,
		).Scan(
			&z.ID, &z.SubscriberID, &z.Label, &z.Latitude, &z.Longitude,
			&z.RadiusKm, &perils, &z.MinMagnitude, &z.IsActive,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		z.PerilTypes = parsePGTextArray(perils)

		c.JSON(http.StatusCreated, gin.H{"data": z})
	}
}

type ewsWatchZoneUpdateBody struct {
	Label        *string  `json:"label"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	RadiusKm     *float64 `json:"radius_km"`
	PerilTypes   []string `json:"peril_types"`
	MinMagnitude *float64 `json:"min_magnitude"`
	IsActive     *bool    `json:"is_active"`
}

const ewsWatchZoneUpdateQuery = `
UPDATE ews_watch_zones SET
    label         = COALESCE($2, label),
    latitude      = COALESCE($3, latitude),
    longitude     = COALESCE($4, longitude),
    radius_km     = COALESCE($5, radius_km),
    peril_types   = COALESCE($6::text[], peril_types),
    min_magnitude = COALESCE($7, min_magnitude),
    is_active     = COALESCE($8, is_active),
    updated_at    = now()
WHERE id = $1
RETURNING id, subscriber_id, label, latitude, longitude, radius_km,
          array_to_string(peril_types, ','), min_magnitude, is_active
`

// EWSWatchZoneUpdate updates mutable watch zone fields.
func EWSWatchZoneUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var body ewsWatchZoneUpdateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_body",
				"message": err.Error(),
			})
			return
		}

		// peril_types: nil slice → leave unchanged (NULL); non-nil → replace.
		var perilArg any
		if body.PerilTypes != nil {
			perilArg = toPGTextArray(body.PerilTypes)
		}

		var z EWSWatchZone
		var perils string
		err := db.QueryRowContext(
			c.Request.Context(), ewsWatchZoneUpdateQuery,
			id, body.Label, body.Latitude, body.Longitude,
			body.RadiusKm, perilArg, body.MinMagnitude, body.IsActive,
		).Scan(
			&z.ID, &z.SubscriberID, &z.Label, &z.Latitude, &z.Longitude,
			&z.RadiusKm, &perils, &z.MinMagnitude, &z.IsActive,
		)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{
					"error":   "watch_zone_not_found",
					"message": "no watch zone found for the provided id",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		z.PerilTypes = parsePGTextArray(perils)

		c.JSON(http.StatusOK, gin.H{"data": z})
	}
}

const ewsWatchZoneDeleteQuery = `
DELETE FROM ews_watch_zones WHERE id = $1 RETURNING id
`

// EWSWatchZoneDelete hard-deletes a watch zone.
func EWSWatchZoneDelete(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		id := strings.TrimSpace(c.Param("id"))
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var deletedID string
		err := db.QueryRowContext(c.Request.Context(), ewsWatchZoneDeleteQuery, id).Scan(&deletedID)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{
					"error":   "watch_zone_not_found",
					"message": "no watch zone found for the provided id",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": deletedID}})
	}
}

// ── Notification Preferences ────────────────────────────────

const ewsPrefsGetQuery = `
SELECT channel, min_severity, array_to_string(alert_types, ','),
       to_char(quiet_hours_start, 'HH24:MI'),
       to_char(quiet_hours_end, 'HH24:MI'),
       is_enabled
FROM ews_notification_prefs
WHERE subscriber_id = $1
ORDER BY channel
`

// EWSNotificationPrefsGet lists a subscriber's notification preferences.
func EWSNotificationPrefsGet(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID := strings.TrimSpace(c.Param("id"))
		if subID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		rows, err := db.QueryContext(c.Request.Context(), ewsPrefsGetQuery, subID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		prefs := make([]gin.H, 0)
		for rows.Next() {
			var channel, minSeverity, alertTypes string
			var quietStart, quietEnd sql.NullString
			var isEnabled bool
			if err := rows.Scan(
				&channel, &minSeverity, &alertTypes,
				&quietStart, &quietEnd, &isEnabled,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			prefs = append(prefs, gin.H{
				"channel":           channel,
				"min_severity":      minSeverity,
				"alert_types":       parsePGTextArray(alertTypes),
				"quiet_hours_start": nullStringPtr(quietStart),
				"quiet_hours_end":   nullStringPtr(quietEnd),
				"is_enabled":        isEnabled,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"data": prefs,
			"meta": gin.H{"count": len(prefs)},
		})
	}
}

type ewsPrefUpdateBody struct {
	Channel         string   `json:"channel"`
	MinSeverity     *string  `json:"min_severity"`
	AlertTypes      []string `json:"alert_types"`
	QuietHoursStart *string  `json:"quiet_hours_start"`
	QuietHoursEnd   *string  `json:"quiet_hours_end"`
	IsEnabled       *bool    `json:"is_enabled"`
}

const ewsPrefUpsertQuery = `
INSERT INTO ews_notification_prefs
    (subscriber_id, channel, min_severity, alert_types,
     quiet_hours_start, quiet_hours_end, is_enabled)
VALUES ($1, $2, COALESCE($3, 'High'), $4::text[],
        $5::time, $6::time, COALESCE($7, TRUE))
ON CONFLICT (subscriber_id, channel) DO UPDATE SET
    min_severity      = COALESCE(EXCLUDED.min_severity, ews_notification_prefs.min_severity),
    alert_types       = EXCLUDED.alert_types,
    quiet_hours_start = EXCLUDED.quiet_hours_start,
    quiet_hours_end   = EXCLUDED.quiet_hours_end,
    is_enabled        = EXCLUDED.is_enabled
RETURNING channel, min_severity, array_to_string(alert_types, ','),
          to_char(quiet_hours_start, 'HH24:MI'),
          to_char(quiet_hours_end, 'HH24:MI'),
          is_enabled
`

// EWSNotificationPrefsUpdate upserts a single channel preference.
func EWSNotificationPrefsUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}
		subID := strings.TrimSpace(c.Param("id"))
		if subID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_id",
				"message": "path parameter 'id' is required",
			})
			return
		}

		var body ewsPrefUpdateBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_body",
				"message": err.Error(),
			})
			return
		}
		if strings.TrimSpace(body.Channel) == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "missing_channel",
				"message": "field 'channel' is required",
			})
			return
		}

		var channel, minSeverity, alertTypes string
		var quietStart, quietEnd sql.NullString
		var isEnabled bool
		err := db.QueryRowContext(
			c.Request.Context(), ewsPrefUpsertQuery,
			subID, body.Channel, body.MinSeverity, toPGTextArray(body.AlertTypes),
			body.QuietHoursStart, body.QuietHoursEnd, body.IsEnabled,
		).Scan(
			&channel, &minSeverity, &alertTypes,
			&quietStart, &quietEnd, &isEnabled,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"channel":           channel,
				"min_severity":      minSeverity,
				"alert_types":       parsePGTextArray(alertTypes),
				"quiet_hours_start": nullStringPtr(quietStart),
				"quiet_hours_end":   nullStringPtr(quietEnd),
				"is_enabled":        isEnabled,
			},
		})
	}
}

// ── Notification Log ────────────────────────────────────────

const ewsNotificationLogQuery = `
SELECT l.id, l.subscriber_id, s.name, l.alert_id, l.channel,
       l.status, l.error_message, l.sent_at, l.created_at
FROM ews_notification_log l
LEFT JOIN ews_subscribers s ON l.subscriber_id = s.id
WHERE ($1::uuid IS NULL OR l.subscriber_id = $1)
  AND ($2::text IS NULL OR l.channel = $2)
  AND ($3::text IS NULL OR l.status = $3)
ORDER BY l.created_at DESC
LIMIT $4 OFFSET $5
`

// EWSNotificationLog lists the delivery audit log with optional filters.
func EWSNotificationLog(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			dbUnavailable(c)
			return
		}

		var subFilter, channelFilter, statusFilter any
		if v := strings.TrimSpace(c.Query("subscriber_id")); v != "" {
			subFilter = v
		}
		if v := strings.TrimSpace(c.Query("channel")); v != "" {
			channelFilter = v
		}
		if v := strings.TrimSpace(c.Query("status")); v != "" {
			statusFilter = v
		}

		limit := 100
		if v := strings.TrimSpace(c.Query("limit")); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		offset := 0
		if v := strings.TrimSpace(c.Query("offset")); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				offset = n
			}
		}

		rows, err := db.QueryContext(
			c.Request.Context(), ewsNotificationLogQuery,
			subFilter, channelFilter, statusFilter, limit, offset,
		)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "database_query_failed",
				"message": err.Error(),
			})
			return
		}
		defer rows.Close()

		entries := make([]gin.H, 0)
		for rows.Next() {
			var id, subscriberID, channel, status string
			var subName, alertID, errMsg sql.NullString
			var sentAt sql.NullTime
			var createdAt time.Time
			if err := rows.Scan(
				&id, &subscriberID, &subName, &alertID, &channel,
				&status, &errMsg, &sentAt, &createdAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error":   "row_scan_failed",
					"message": err.Error(),
				})
				return
			}
			var sentAtPtr *time.Time
			if sentAt.Valid {
				sentAtPtr = &sentAt.Time
			}
			entries = append(entries, gin.H{
				"id":              id,
				"subscriber_id":   subscriberID,
				"subscriber_name": nullStringPtr(subName),
				"alert_id":        nullStringPtr(alertID),
				"channel":         channel,
				"status":          status,
				"error_message":   nullStringPtr(errMsg),
				"sent_at":         sentAtPtr,
				"created_at":      createdAt,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"data": entries,
			"meta": gin.H{"count": len(entries), "limit": limit, "offset": offset},
		})
	}
}

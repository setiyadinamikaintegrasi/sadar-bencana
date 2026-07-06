package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type ewsChannelSettingBody struct {
	IsEnabled *bool `json:"is_enabled"`
}

var ewsWorkerHTTPClient = &http.Client{Timeout: 20 * time.Second}

func ewsWorkerRequest(
	c *gin.Context,
	method string,
	endpoint string,
	workerToken string,
) (*http.Response, error) {
	request, err := http.NewRequestWithContext(c.Request.Context(), method, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+workerToken)
	return ewsWorkerHTTPClient.Do(request)
}

func writeWorkerResponse(c *gin.Context, response *http.Response) {
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "worker_response_failed"})
		return
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Data(response.StatusCode, contentType, body)
}

func reserveEWSTestRequest(
	c *gin.Context,
	db *sql.DB,
	requestedBy string,
	subscriberID string,
	channel string,
	isAdmin bool,
) bool {
	actorLimit := 3
	if isAdmin {
		actorLimit = 20
	}
	var reserved bool
	err := db.QueryRowContext(
		c.Request.Context(),
		`WITH request_counts AS (
		   SELECT
		     count(*) FILTER (
		       WHERE requested_by = $1 AND channel = $3
		         AND requested_at > now() - interval '1 hour'
		     ) AS actor_count,
		     count(*) FILTER (
		       WHERE requested_at > now() - interval '1 hour'
		     ) AS global_count
		   FROM ews_test_requests
		 ), inserted AS (
		   INSERT INTO ews_test_requests
		     (requested_by, subscriber_id, channel, is_admin)
		   SELECT $1, $2, $3, $4
		   FROM request_counts
		   WHERE actor_count < $5 AND global_count < 60
		   RETURNING id
		 )
		 SELECT EXISTS (SELECT 1 FROM inserted)`,
		requestedBy,
		subscriberID,
		channel,
		isAdmin,
		actorLimit,
	).Scan(&reserved)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "rate_limit_check_failed"})
		return false
	}
	if !reserved {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "test_rate_limit_exceeded"})
		return false
	}
	return true
}

func EWSChannelsStatus(workerBaseURL, workerToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		response, err := ewsWorkerRequest(
			c,
			http.MethodGet,
			strings.TrimRight(workerBaseURL, "/")+"/api/v1/worker/ews/channels/status",
			workerToken,
		)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "worker_unavailable"})
			return
		}
		writeWorkerResponse(c, response)
	}
}

func EWSChannelSettingUpdate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		channel := strings.TrimSpace(c.Param("channel"))
		if _, ok := ewsChannels[channel]; !ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported_channel"})
			return
		}
		var body ewsChannelSettingBody
		if err := c.ShouldBindJSON(&body); err != nil || body.IsEnabled == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		var provider string
		var updatedAt any
		err := db.QueryRowContext(
			c.Request.Context(),
			`WITH previous AS MATERIALIZED (
			   SELECT channel, is_enabled
			   FROM ews_channel_settings
			   WHERE channel = $1
			 ), changed AS (
			   UPDATE ews_channel_settings
			   SET is_enabled = $2, updated_by = $3, updated_at = now()
			   WHERE channel = $1
			   RETURNING channel, provider, is_enabled, updated_at
			 ), audited AS (
			   INSERT INTO ews_channel_setting_audit
			     (channel, previous_enabled, new_enabled, changed_by)
			   SELECT changed.channel, previous.is_enabled, changed.is_enabled, $3
			   FROM changed JOIN previous USING (channel)
			   WHERE previous.is_enabled IS DISTINCT FROM changed.is_enabled
			 )
			 SELECT provider, updated_at FROM changed`,
			channel,
			*body.IsEnabled,
			AuthEmail(c),
		).Scan(&provider, &updatedAt)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"channel": channel, "is_enabled": *body.IsEnabled,
			"provider": provider, "updated_at": updatedAt,
		}})
	}
}

func EWSChannelSettingAudit(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := db.QueryContext(
			c.Request.Context(),
			`SELECT id, channel, previous_enabled, new_enabled, changed_by, changed_at
			 FROM ews_channel_setting_audit
			 ORDER BY changed_at DESC LIMIT 100`,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()
		items := make([]gin.H, 0)
		for rows.Next() {
			var id, channel, changedBy string
			var previousEnabled, newEnabled bool
			var changedAt time.Time
			if err := rows.Scan(
				&id, &channel, &previousEnabled, &newEnabled, &changedBy, &changedAt,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			items = append(items, gin.H{
				"id": id, "channel": channel,
				"previous_enabled": previousEnabled, "new_enabled": newEnabled,
				"changed_by": changedBy, "changed_at": changedAt,
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": items, "meta": gin.H{"count": len(items)}})
	}
}

func proxyEWSTest(
	c *gin.Context,
	db *sql.DB,
	subscriberID string,
	channel string,
	requestedBy string,
	isAdmin bool,
	workerBaseURL string,
	workerToken string,
) {
	if _, ok := ewsChannels[channel]; !ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "unsupported_channel"})
		return
	}
	enabled := true
	if !validateEWSPreference(
		c, db, subscriberID, channel, nil, nil, nil, nil, &enabled,
	) {
		return
	}
	if !reserveEWSTestRequest(
		c, db, requestedBy, subscriberID, channel, isAdmin,
	) {
		return
	}
	endpoint := strings.TrimRight(workerBaseURL, "/") +
		"/api/v1/worker/ews/test-dispatch/" + url.PathEscape(subscriberID) +
		"?channel=" + url.QueryEscape(channel)
	if isAdmin {
		endpoint += "&force=true"
	}
	response, err := ewsWorkerRequest(c, http.MethodPost, endpoint, workerToken)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "worker_unavailable"})
		return
	}
	writeWorkerResponse(c, response)
}

func EWSMeChannelTest(
	db *sql.DB,
	workerBaseURL string,
	workerToken string,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		subscriberID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		proxyEWSTest(
			c, db, subscriberID, c.Param("channel"), AuthUserID(c), false,
			workerBaseURL, workerToken,
		)
	}
}

func EWSAdminChannelTest(
	db *sql.DB,
	workerBaseURL string,
	workerToken string,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		proxyEWSTest(
			c, db, c.Param("id"), c.Param("channel"), AuthEmail(c), true,
			workerBaseURL, workerToken,
		)
	}
}

func EWSDeliveryRetry(workerBaseURL, workerToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		endpoint := strings.TrimRight(workerBaseURL, "/") +
			"/api/v1/worker/ews/deliveries/" +
			url.PathEscape(c.Param("id")) + "/retry"
		response, err := ewsWorkerRequest(
			c, http.MethodPost, endpoint, workerToken,
		)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "worker_unavailable"})
			return
		}
		writeWorkerResponse(c, response)
	}
}

func EWSMeChannelsStatus(
	db *sql.DB,
	workerBaseURL string,
	workerToken string,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		subscriberID, ok := resolveSubscriber(c, db)
		if !ok {
			return
		}
		response, err := ewsWorkerRequest(
			c,
			http.MethodGet,
			strings.TrimRight(workerBaseURL, "/")+"/api/v1/worker/ews/channels/status",
			workerToken,
		)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "worker_unavailable"})
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			writeWorkerResponse(c, response)
			return
		}
		var providerStatus struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&providerStatus); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "worker_response_failed"})
			return
		}
		rows, err := db.QueryContext(
			c.Request.Context(),
			`SELECT channels.channel, p.is_enabled,
			        CASE WHEN channels.channel = 'telegram' THEN s.telegram_chat_id IS NOT NULL
			             WHEN channels.channel = 'email' THEN s.email IS NOT NULL AND s.email <> ''
			             ELSE FALSE END AS recipient_configured,
			        EXISTS (
			          SELECT 1 FROM ews_watch_zones z
			          WHERE z.subscriber_id = s.id AND z.is_active = TRUE
			        ) AS has_watch_zone,
			        EXISTS (
			          SELECT 1 FROM ews_channel_verifications v
			          WHERE v.subscriber_id = s.id
			            AND v.channel = channels.channel
			        ) AS is_verified
			 FROM ews_subscribers s
			 CROSS JOIN (VALUES ('telegram'), ('email')) channels(channel)
			 LEFT JOIN ews_notification_prefs p
			   ON p.subscriber_id = s.id AND p.channel = channels.channel
			 WHERE s.id = $1
			 ORDER BY channels.channel`,
			subscriberID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			return
		}
		defer rows.Close()
		userStatus := map[string]map[string]any{}
		for rows.Next() {
			var channel sql.NullString
			var enabled sql.NullBool
			var recipientConfigured, hasWatchZone, isVerified bool
			if err := rows.Scan(&channel, &enabled, &recipientConfigured, &hasWatchZone, &isVerified); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			name := channel.String
			if name == "" {
				continue
			}
			userStatus[name] = map[string]any{
				"is_enabled":           enabled.Valid && enabled.Bool,
				"recipient_configured": recipientConfigured,
				"has_watch_zone":       hasWatchZone,
				"is_verified":          isVerified,
			}
		}
		for _, item := range providerStatus.Data {
			channel, _ := item["channel"].(string)
			for key, value := range userStatus[channel] {
				item[key] = value
			}
		}
		var buffer bytes.Buffer
		if err := json.NewEncoder(&buffer).Encode(gin.H{"data": providerStatus.Data}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "response_encode_failed"})
			return
		}
		c.Data(http.StatusOK, "application/json", buffer.Bytes())
	}
}

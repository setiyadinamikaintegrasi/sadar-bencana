package http

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type OfficialSourceSetting struct {
	SourceName          string    `json:"source_name"`
	DisplayName         string    `json:"display_name"`
	Enabled             bool      `json:"enabled"`
	Mode                string    `json:"mode"`
	DefaultAPIURL       *string   `json:"default_api_url"`
	CustomAPIURL        *string   `json:"custom_api_url"`
	HasAPIToken         bool      `json:"has_api_token"`
	Attribution         string    `json:"attribution"`
	TermsURL            *string   `json:"terms_url"`
	PollIntervalSeconds int       `json:"poll_interval_seconds"`
	Notes               *string   `json:"notes"`
	UpdatedAt           time.Time `json:"updated_at"`
}

func requireSettingsAdmin(c *gin.Context, db *sql.DB) bool {
	if !isEWSAdmin(c, db) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin_required"})
		return false
	}
	return true
}

func OfficialSourceSettingsList(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		rows, err := db.QueryContext(c.Request.Context(), `
			SELECT source_name, display_name, enabled, mode, default_api_url,
			       custom_api_url, api_token_encrypted IS NOT NULL, attribution,
			       terms_url, poll_interval_seconds, notes, updated_at
			FROM official_source_settings ORDER BY display_name`)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		defer rows.Close()
		items := make([]OfficialSourceSetting, 0)
		for rows.Next() {
			var item OfficialSourceSetting
			var defaultURL, customURL, termsURL, notes sql.NullString
			if err := rows.Scan(&item.SourceName, &item.DisplayName, &item.Enabled, &item.Mode,
				&defaultURL, &customURL, &item.HasAPIToken, &item.Attribution, &termsURL,
				&item.PollIntervalSeconds, &notes, &item.UpdatedAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			item.DefaultAPIURL = nullStringPtr(defaultURL)
			item.CustomAPIURL = nullStringPtr(customURL)
			item.TermsURL = nullStringPtr(termsURL)
			item.Notes = nullStringPtr(notes)
			items = append(items, item)
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

type sourceSettingUpdate struct {
	Enabled             bool    `json:"enabled"`
	Mode                string  `json:"mode"`
	CustomAPIURL        *string `json:"custom_api_url"`
	APIToken            *string `json:"api_token"`
	PollIntervalSeconds int     `json:"poll_interval_seconds"`
}

func OfficialSourceSettingUpdate(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var body sourceSettingUpdate
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		if body.Mode != "auto" && body.Mode != "default_public" && body.Mode != "custom_api" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_mode"})
			return
		}
		customURL := strings.TrimSpace(valueString(body.CustomAPIURL))
		if customURL != "" {
			parsed, err := url.Parse(customURL)
			if err != nil || parsed.Scheme != "https" || !approvedSourceHost(source, parsed.Hostname()) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_api_url"})
				return
			}
		}
		token := valueString(body.APIToken)
		if token != "" && encryptionKey == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "settings_encryption_not_configured"})
			return
		}
		interval := body.PollIntervalSeconds
		if interval == 0 {
			interval = 600
		}
		result, err := db.ExecContext(c.Request.Context(), `
			UPDATE official_source_settings SET enabled=$2, mode=$3,
			  custom_api_url=NULLIF($4,''), poll_interval_seconds=$5,
			  api_token_encrypted=CASE WHEN $6='' THEN api_token_encrypted
			    ELSE pgp_sym_encrypt($6,$7) END,
			  updated_by=$8, updated_at=now()
			WHERE source_name=$1`,
			source, body.Enabled, body.Mode, customURL, interval, token, encryptionKey, AuthEmail(c))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_update_failed", "message": err.Error()})
			return
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "updated": true}})
	}
}

func OfficialSourceSettingTest(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var mode string
		var defaultURL, customURL, token sql.NullString
		err := db.QueryRowContext(c.Request.Context(), `
			SELECT mode, default_api_url, custom_api_url,
			       CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
			         THEN pgp_sym_decrypt(api_token_encrypted,$2) END
			FROM official_source_settings WHERE source_name=$1`,
			source, encryptionKey).Scan(&mode, &defaultURL, &customURL, &token)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		endpoint := ""
		if mode == "custom_api" || (mode == "auto" && customURL.Valid) {
			endpoint = customURL.String
		} else if defaultURL.Valid {
			endpoint = defaultURL.String
		}
		parsed, parseErr := url.Parse(endpoint)
		if parseErr != nil || !approvedSourceHost(source, parsed.Hostname()) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "official_api_not_configured"})
			return
		}
		request, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, endpoint, nil)
		request.Header.Set("User-Agent", "SadarBencana/0.4 source-validation")
		if token.Valid {
			request.Header.Set("Authorization", "Bearer "+token.String)
		}
		started := time.Now()
		response, err := (&http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}).Do(request)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"data": gin.H{"reachable": false, "contract_valid": false, "error": err.Error()}})
			return
		}
		defer response.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		contractValid := response.StatusCode >= 200 && response.StatusCode < 300 && readErr == nil
		if contractValid && source != "bmkg_cap" {
			var payload any
			contractValid = json.Unmarshal(body, &payload) == nil
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"reachable":      response.StatusCode >= 200 && response.StatusCode < 500,
			"contract_valid": contractValid,
			"status_code":    response.StatusCode,
			"content_type":   response.Header.Get("Content-Type"),
			"latency_ms":     time.Since(started).Milliseconds(),
		}})
	}
}

func valueString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func approvedSourceHost(source, host string) bool {
	host = strings.ToLower(host)
	suffixes := map[string][]string{
		"bmkg":     {"bmkg.go.id"},
		"bmkg_cap": {"bmkg.go.id"}, "inatews": {"bmkg.go.id"},
		"pvmbg": {"esdm.go.id"}, "bnpb": {"bnpb.go.id"},
		"inarisk": {"bnpb.go.id"},
	}
	for _, suffix := range suffixes[source] {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

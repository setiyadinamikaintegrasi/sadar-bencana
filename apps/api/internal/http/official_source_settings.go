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
	SourceName          string            `json:"source_name"`
	DisplayName         string            `json:"display_name"`
	Enabled             bool              `json:"enabled"`
	RunMode             string            `json:"run_mode"`
	Mode                string            `json:"mode"`
	AdapterVersion      string            `json:"adapter_version"`
	FieldMapping        map[string]string `json:"field_mapping"`
	ConfigVersion       int               `json:"config_version"`
	DefaultAPIURL       *string           `json:"default_api_url"`
	CustomAPIURL        *string           `json:"custom_api_url"`
	HasAPIToken         bool              `json:"has_api_token"`
	Attribution         string            `json:"attribution"`
	TermsURL            *string           `json:"terms_url"`
	PollIntervalSeconds int               `json:"poll_interval_seconds"`
	Notes               *string           `json:"notes"`
	LastDryRunAt        *time.Time        `json:"last_dry_run_at"`
	LastDryRunValid     *bool             `json:"last_dry_run_valid"`
	UpdatedAt           time.Time         `json:"updated_at"`
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
			SELECT source_name, display_name, enabled, run_mode, mode,
			       adapter_version, field_mapping, config_version, default_api_url,
			       custom_api_url, api_token_encrypted IS NOT NULL, attribution,
			       terms_url, poll_interval_seconds, notes, last_dry_run_at,
			       last_dry_run_valid, updated_at
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
			var mapping []byte
			var dryRunAt sql.NullTime
			var dryRunValid sql.NullBool
			if err := rows.Scan(&item.SourceName, &item.DisplayName, &item.Enabled, &item.RunMode,
				&item.Mode, &item.AdapterVersion, &mapping, &item.ConfigVersion, &defaultURL,
				&customURL, &item.HasAPIToken, &item.Attribution, &termsURL,
				&item.PollIntervalSeconds, &notes, &dryRunAt, &dryRunValid, &item.UpdatedAt); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "row_scan_failed"})
				return
			}
			item.FieldMapping = map[string]string{}
			_ = json.Unmarshal(mapping, &item.FieldMapping)
			item.DefaultAPIURL = nullStringPtr(defaultURL)
			item.CustomAPIURL = nullStringPtr(customURL)
			item.TermsURL = nullStringPtr(termsURL)
			item.Notes = nullStringPtr(notes)
			if dryRunAt.Valid {
				item.LastDryRunAt = &dryRunAt.Time
			}
			if dryRunValid.Valid {
				item.LastDryRunValid = &dryRunValid.Bool
			}
			items = append(items, item)
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

type sourceSettingUpdate struct {
	Enabled             bool              `json:"enabled"`
	RunMode             string            `json:"run_mode"`
	Mode                string            `json:"mode"`
	AdapterVersion      string            `json:"adapter_version"`
	FieldMapping        map[string]string `json:"field_mapping"`
	CustomAPIURL        *string           `json:"custom_api_url"`
	APIToken            *string           `json:"api_token"`
	PollIntervalSeconds int               `json:"poll_interval_seconds"`
	ChangeReason        string            `json:"change_reason"`
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
		runMode := body.RunMode
		if runMode == "" {
			if body.Enabled {
				runMode = "active"
			} else {
				runMode = "disabled"
			}
		}
		if runMode != "disabled" && runMode != "dry_run" && runMode != "active" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_run_mode"})
			return
		}
		if body.FieldMapping == nil {
			body.FieldMapping = map[string]string{}
		}
		adapterVersion := strings.TrimSpace(body.AdapterVersion)
		if adapterVersion == "" {
			adapterVersion = "v1"
		}
		if err := validateAdapterConfiguration(source, adapterVersion, body.FieldMapping); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_adapter_configuration", "message": err.Error()})
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
		if interval < 60 || interval > 86400 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_poll_interval"})
			return
		}
		currentMode := ""
		if err := db.QueryRowContext(c.Request.Context(),
			`SELECT run_mode FROM official_source_settings WHERE source_name=$1`, source).Scan(&currentMode); err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			}
			return
		}
		if runMode == "active" && currentMode != "active" {
			c.JSON(http.StatusConflict, gin.H{"error": "dry_run_required", "message": "save as dry_run, run validation, then activate"})
			return
		}
		mappingJSON, _ := json.Marshal(body.FieldMapping)
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_transaction_failed"})
			return
		}
		defer tx.Rollback()
		var version int
		err = tx.QueryRowContext(c.Request.Context(), `
			WITH updated AS (
			  UPDATE official_source_settings SET
			    enabled=$2, run_mode=$3, mode=$4, adapter_version=$5,
			    field_mapping=$6::jsonb, custom_api_url=NULLIF($7,''),
			    poll_interval_seconds=$8,
			    api_token_encrypted=CASE WHEN $9='' THEN api_token_encrypted
			      ELSE pgp_sym_encrypt($9,$10) END,
			    config_version=config_version+1,
			    last_dry_run_at=NULL, last_dry_run_valid=NULL,
			    last_dry_run_config_version=NULL,
			    updated_by=$11, updated_at=now()
			  WHERE source_name=$1
			  RETURNING *
			)
			INSERT INTO official_source_setting_versions
			  (source_name, version, configuration, api_token_encrypted, changed_by, change_reason)
			SELECT source_name, config_version,
			  jsonb_build_object(
			    'enabled', enabled, 'run_mode', run_mode, 'mode', mode,
			    'adapter_version', adapter_version, 'field_mapping', field_mapping,
			    'custom_api_url', custom_api_url,
			    'poll_interval_seconds', poll_interval_seconds
			  ),
			  api_token_encrypted, $11, NULLIF($12,'')
			FROM updated
			RETURNING version`,
			source, runMode != "disabled", runMode, body.Mode, adapterVersion,
			string(mappingJSON), customURL, interval, token, encryptionKey,
			AuthEmail(c), strings.TrimSpace(body.ChangeReason)).Scan(&version)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_update_failed", "message": err.Error()})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO official_source_setting_audit
			  (source_name, action, actor_email, config_version, success, metadata)
			VALUES ($1,'update',$2,$3,TRUE,jsonb_build_object('run_mode',$4,'adapter_version',$5))`,
			source, AuthEmail(c), version, runMode, adapterVersion)
		if err != nil || tx.Commit() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_audit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "updated": true, "config_version": version}})
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

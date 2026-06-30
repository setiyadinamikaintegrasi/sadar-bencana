package http

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var adapterContracts = map[string]map[string][]string{
	"bmkg":     {"v1": {}},
	"bmkg_cap": {"v1": {}},
	"inatews":  {"v1": {"event_group_id", "sent_at"}},
	"pvmbg":    {"v1": {"volcano_id", "level", "published_at"}},
	"bnpb":     {"v1": {"report_id", "observed_at"}},
	"inarisk":  {"v1": {"layer_id", "context_type", "data_vintage", "attribution"}},
}

func validateAdapterConfiguration(source, version string, mapping map[string]string) error {
	versions, ok := adapterContracts[source]
	if !ok {
		return fmt.Errorf("unsupported source %q", source)
	}
	if _, ok := versions[version]; !ok {
		return fmt.Errorf("adapter %s/%s is not registered", source, version)
	}
	for field, path := range mapping {
		if strings.TrimSpace(field) == "" || strings.TrimSpace(path) == "" {
			return errors.New("mapping keys and paths cannot be empty")
		}
		if field == "__records" {
			continue
		}
		for _, segment := range strings.Split(path, ".") {
			if strings.TrimSpace(segment) == "" {
				return fmt.Errorf("invalid mapping path %q", path)
			}
		}
	}
	return nil
}

func mappedValue(record map[string]any, path string) any {
	var current any = record
	for _, segment := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current, ok = object[segment]
		if !ok {
			return nil
		}
	}
	return current
}

func mapOfficialRecord(record map[string]any, mapping map[string]string) map[string]any {
	result := make(map[string]any, len(record)+len(mapping))
	for key, value := range record {
		result[key] = value
	}
	for canonical, path := range mapping {
		if canonical != "__records" {
			result[canonical] = mappedValue(record, path)
		}
	}
	return result
}

func payloadRecords(payload any, mapping map[string]string) []map[string]any {
	value := payload
	if path := strings.TrimSpace(mapping["__records"]); path != "" {
		root, ok := payload.(map[string]any)
		if !ok {
			return nil
		}
		value = mappedValue(root, path)
	} else if root, ok := payload.(map[string]any); ok {
		for _, key := range []string{"data", "items", "results"} {
			if candidate, exists := root[key]; exists {
				value = candidate
				break
			}
		}
	}
	items, ok := value.([]any)
	if !ok {
		if item, single := value.(map[string]any); single {
			return []map[string]any{item}
		}
		return nil
	}
	records := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			records = append(records, record)
		}
	}
	return records
}

func sanitizePreview(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "token") || strings.Contains(lower, "secret") ||
				strings.Contains(lower, "password") || strings.Contains(lower, "authorization") {
				result[key] = "[REDACTED]"
			} else {
				result[key] = sanitizePreview(item)
			}
		}
		return result
	case []any:
		limit := len(typed)
		if limit > 3 {
			limit = 3
		}
		result := make([]any, 0, limit)
		for _, item := range typed[:limit] {
			result = append(result, sanitizePreview(item))
		}
		return result
	default:
		return value
	}
}

type sourcePreviewDraft struct {
	Mode           string            `json:"mode"`
	CustomAPIURL   *string           `json:"custom_api_url"`
	APIToken       *string           `json:"api_token"`
	AdapterVersion string            `json:"adapter_version"`
	FieldMapping   map[string]string `json:"field_mapping"`
}

type sourceRuntimeConfig struct {
	Source         string
	Mode           string
	RunMode        string
	Endpoint       string
	Token          string
	AdapterVersion string
	FieldMapping   map[string]string
	ConfigVersion  int
}

type sourcePreviewResult struct {
	Reachable      bool             `json:"reachable"`
	ContractValid  bool             `json:"contract_valid"`
	StatusCode     int              `json:"status_code"`
	ContentType    string           `json:"content_type"`
	AdapterVersion string           `json:"adapter_version"`
	RecordCount    int              `json:"record_count"`
	ValidCount     int              `json:"valid_count"`
	InvalidCount   int              `json:"invalid_count"`
	Errors         []string         `json:"errors"`
	RawSample      any              `json:"raw_sample"`
	MappedSample   []map[string]any `json:"mapped_sample"`
	PayloadStored  bool             `json:"payload_stored"`
	LatencyMS      int64            `json:"latency_ms"`
}

func loadSourceRuntimeConfig(
	db *sql.DB,
	source, encryptionKey string,
	draft *sourcePreviewDraft,
) (sourceRuntimeConfig, error) {
	var config sourceRuntimeConfig
	var defaultURL, customURL, token sql.NullString
	var mapping []byte
	err := db.QueryRow(`
		SELECT source_name, mode, run_mode, default_api_url, custom_api_url,
		       adapter_version, field_mapping, config_version,
		       CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
		         THEN pgp_sym_decrypt(api_token_encrypted,$2) END
		FROM official_source_settings WHERE source_name=$1`,
		source, encryptionKey,
	).Scan(&config.Source, &config.Mode, &config.RunMode, &defaultURL, &customURL,
		&config.AdapterVersion, &mapping, &config.ConfigVersion, &token)
	if err != nil {
		return config, err
	}
	config.FieldMapping = map[string]string{}
	_ = json.Unmarshal(mapping, &config.FieldMapping)
	config.Token = token.String
	if config.Mode == "custom_api" || (config.Mode == "auto" && customURL.Valid) {
		config.Endpoint = customURL.String
	} else {
		config.Endpoint = defaultURL.String
	}
	if draft != nil {
		if draft.Mode != "" {
			config.Mode = draft.Mode
		}
		if draft.CustomAPIURL != nil {
			config.Endpoint = strings.TrimSpace(*draft.CustomAPIURL)
		}
		if draft.APIToken != nil && *draft.APIToken != "" {
			config.Token = *draft.APIToken
		}
		if draft.AdapterVersion != "" {
			config.AdapterVersion = strings.TrimSpace(draft.AdapterVersion)
		}
		if draft.FieldMapping != nil {
			config.FieldMapping = draft.FieldMapping
		}
	}
	return config, nil
}

func executeSourcePreview(ctx *gin.Context, config sourceRuntimeConfig) (sourcePreviewResult, error) {
	result := sourcePreviewResult{
		AdapterVersion: config.AdapterVersion,
		Errors:         []string{},
		MappedSample:   []map[string]any{},
		PayloadStored:  false,
	}
	if err := validateAdapterConfiguration(config.Source, config.AdapterVersion, config.FieldMapping); err != nil {
		return result, err
	}
	parsed, err := url.Parse(config.Endpoint)
	if err != nil || parsed.Scheme != "https" || !approvedSourceHost(config.Source, parsed.Hostname()) {
		return result, errors.New("official API URL is missing or not approved")
	}
	request, _ := http.NewRequestWithContext(ctx.Request.Context(), http.MethodGet, config.Endpoint, nil)
	request.Header.Set("User-Agent", "SadarBencana/0.4 source-preview")
	if config.Token != "" {
		request.Header.Set("Authorization", "Bearer "+config.Token)
	}
	started := time.Now()
	response, err := (&http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}).Do(request)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	result.StatusCode = response.StatusCode
	result.ContentType = response.Header.Get("Content-Type")
	result.Reachable = response.StatusCode >= 200 && response.StatusCode < 500
	result.LatencyMS = time.Since(started).Milliseconds()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return result, err
	}
	var payload any
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&payload); err != nil {
		result.Errors = append(result.Errors, "response is not valid JSON")
		result.RawSample = string(body[:min(len(body), 2000)])
		return result, nil
	}
	result.RawSample = sanitizePreview(payload)
	records := payloadRecords(payload, config.FieldMapping)
	result.RecordCount = len(records)
	required := adapterContracts[config.Source][config.AdapterVersion]
	for index, raw := range records {
		mapped := mapOfficialRecord(raw, config.FieldMapping)
		missing := make([]string, 0)
		for _, field := range required {
			if value, exists := mapped[field]; !exists || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
				missing = append(missing, field)
			}
		}
		if len(missing) > 0 {
			result.InvalidCount++
			if len(result.Errors) < 10 {
				result.Errors = append(result.Errors, fmt.Sprintf("record %d missing: %s", index, strings.Join(missing, ", ")))
			}
		} else {
			result.ValidCount++
		}
		if len(result.MappedSample) < 3 {
			result.MappedSample = append(result.MappedSample, sanitizePreview(mapped).(map[string]any))
		}
	}
	result.ContractValid = response.StatusCode >= 200 && response.StatusCode < 300 &&
		result.RecordCount > 0 && result.InvalidCount == 0
	return result, nil
}

func writeSourceAudit(db *sql.DB, source, action, actor string, version int, success bool, metadata any) {
	payload, _ := json.Marshal(metadata)
	_, _ = db.Exec(`
		INSERT INTO official_source_setting_audit
		  (source_name, action, actor_email, config_version, success, metadata)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
		source, action, actor, version, success, string(payload))
}

func OfficialSourcePreview(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var draft sourcePreviewDraft
		if err := c.ShouldBindJSON(&draft); err != nil && err != io.EOF {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		config, err := loadSourceRuntimeConfig(db, source, encryptionKey, &draft)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_query_failed"})
			return
		}
		result, previewErr := executeSourcePreview(c, config)
		writeSourceAudit(db, source, "preview", AuthEmail(c), config.ConfigVersion, previewErr == nil && result.ContractValid,
			gin.H{"record_count": result.RecordCount, "valid_count": result.ValidCount, "payload_stored": false})
		if previewErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "preview_failed", "message": previewErr.Error(), "data": result})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	}
}

func OfficialSourceDryRun(db *sql.DB, encryptionKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		config, err := loadSourceRuntimeConfig(db, source, encryptionKey, nil)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "source_not_found"})
			return
		}
		if config.RunMode != "dry_run" {
			c.JSON(http.StatusConflict, gin.H{"error": "dry_run_mode_required"})
			return
		}
		result, previewErr := executeSourcePreview(c, config)
		valid := previewErr == nil && result.ContractValid
		_, updateErr := db.ExecContext(c.Request.Context(), `
			UPDATE official_source_settings SET last_dry_run_at=now(),
			  last_dry_run_valid=$2, last_dry_run_config_version=config_version
			WHERE source_name=$1`, source, valid)
		writeSourceAudit(db, source, "dry_run", AuthEmail(c), config.ConfigVersion, valid,
			gin.H{"record_count": result.RecordCount, "valid_count": result.ValidCount, "invalid_count": result.InvalidCount})
		if updateErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "dry_run_state_failed"})
			return
		}
		if previewErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "dry_run_failed", "message": previewErr.Error(), "data": result})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
	}
}

func OfficialSourceActivate(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_transaction_failed"})
			return
		}
		defer tx.Rollback()
		var version int
		err = tx.QueryRowContext(c.Request.Context(), `
			WITH updated AS (
			  UPDATE official_source_settings SET enabled=TRUE, run_mode='active',
			    config_version=config_version+1, updated_by=$2, updated_at=now()
			  WHERE source_name=$1 AND run_mode='dry_run'
			    AND last_dry_run_valid=TRUE
			    AND last_dry_run_config_version=config_version
			  RETURNING *
			)
			INSERT INTO official_source_setting_versions
			  (source_name, version, configuration, api_token_encrypted, changed_by, change_reason)
			SELECT source_name, config_version,
			  jsonb_build_object(
			    'enabled',enabled,'run_mode',run_mode,'mode',mode,
			    'adapter_version',adapter_version,'field_mapping',field_mapping,
			    'custom_api_url',custom_api_url,'poll_interval_seconds',poll_interval_seconds
			  ),
			  api_token_encrypted,$2,'Activated after successful dry run'
			FROM updated RETURNING version`,
			source, AuthEmail(c)).Scan(&version)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusConflict, gin.H{"error": "successful_current_dry_run_required"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_failed"})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO official_source_setting_audit
			  (source_name,action,actor_email,config_version,success,metadata)
			VALUES ($1,'activate',$2,$3,TRUE,'{}'::jsonb)`,
			source, AuthEmail(c), version)
		if err != nil || tx.Commit() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_audit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "run_mode": "active", "config_version": version}})
	}
}

type sourceRollbackBody struct {
	Version int    `json:"version"`
	Reason  string `json:"reason"`
}

func OfficialSourceRollback(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		var body sourceRollbackBody
		if c.ShouldBindJSON(&body) != nil || body.Version < 1 || strings.TrimSpace(body.Reason) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "version_and_reason_required"})
			return
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "database_transaction_failed"})
			return
		}
		defer tx.Rollback()
		var version int
		err = tx.QueryRowContext(c.Request.Context(), `
			WITH target AS (
			  SELECT configuration, api_token_encrypted
			  FROM official_source_setting_versions
			  WHERE source_name=$1 AND version=$2
			), updated AS (
			  UPDATE official_source_settings s SET
			    enabled=COALESCE((t.configuration->>'enabled')::boolean,FALSE),
			    run_mode=COALESCE(t.configuration->>'run_mode','disabled'),
			    mode=COALESCE(t.configuration->>'mode','auto'),
			    adapter_version=COALESCE(t.configuration->>'adapter_version','v1'),
			    field_mapping=COALESCE(t.configuration->'field_mapping','{}'::jsonb),
			    custom_api_url=NULLIF(t.configuration->>'custom_api_url',''),
			    poll_interval_seconds=COALESCE((t.configuration->>'poll_interval_seconds')::int,600),
			    api_token_encrypted=t.api_token_encrypted,
			    config_version=s.config_version+1,
			    last_dry_run_at=NULL,last_dry_run_valid=NULL,last_dry_run_config_version=NULL,
			    updated_by=$3,updated_at=now()
			  FROM target t WHERE s.source_name=$1 RETURNING s.*
			)
			INSERT INTO official_source_setting_versions
			  (source_name,version,configuration,api_token_encrypted,changed_by,change_reason)
			SELECT source_name,config_version,
			  jsonb_build_object(
			    'enabled',enabled,'run_mode',run_mode,'mode',mode,
			    'adapter_version',adapter_version,'field_mapping',field_mapping,
			    'custom_api_url',custom_api_url,'poll_interval_seconds',poll_interval_seconds
			  ),
			  api_token_encrypted,$3,$4
			FROM updated RETURNING version`,
			source, body.Version, AuthEmail(c), strings.TrimSpace(body.Reason)).Scan(&version)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "version_not_found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rollback_failed", "message": err.Error()})
			return
		}
		_, err = tx.ExecContext(c.Request.Context(), `
			INSERT INTO official_source_setting_audit
			  (source_name,action,actor_email,config_version,success,metadata)
			VALUES ($1,'rollback',$2,$3,TRUE,jsonb_build_object('target_version',$4,'reason',$5))`,
			source, AuthEmail(c), version, body.Version, strings.TrimSpace(body.Reason))
		if err != nil || tx.Commit() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "rollback_audit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"source_name": source, "config_version": version}})
	}
}

func OfficialSourceHistory(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !requireSettingsAdmin(c, db) {
			if db == nil {
				dbUnavailable(c)
			}
			return
		}
		source := strings.TrimSpace(c.Param("source"))
		rows, err := db.QueryContext(c.Request.Context(), `
			SELECT version,configuration,changed_by,change_reason,created_at
			FROM official_source_setting_versions
			WHERE source_name=$1 ORDER BY version DESC LIMIT 20`, source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "history_query_failed"})
			return
		}
		defer rows.Close()
		versions := make([]gin.H, 0)
		for rows.Next() {
			var version int
			var configuration []byte
			var actor string
			var reason sql.NullString
			var created time.Time
			if rows.Scan(&version, &configuration, &actor, &reason, &created) != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "history_scan_failed"})
				return
			}
			var config any
			_ = json.Unmarshal(configuration, &config)
			versions = append(versions, gin.H{
				"version": version, "configuration": config, "changed_by": actor,
				"change_reason": nullStringPtr(reason), "created_at": created,
			})
		}
		auditRows, err := db.QueryContext(c.Request.Context(), `
			SELECT action,actor_email,config_version,success,metadata,created_at
			FROM official_source_setting_audit
			WHERE source_name=$1 ORDER BY created_at DESC LIMIT 50`, source)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "audit_query_failed"})
			return
		}
		defer auditRows.Close()
		audit := make([]gin.H, 0)
		for auditRows.Next() {
			var action, actor string
			var version sql.NullInt64
			var success bool
			var metadata []byte
			var created time.Time
			if auditRows.Scan(&action, &actor, &version, &success, &metadata, &created) != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "audit_scan_failed"})
				return
			}
			var meta any
			_ = json.Unmarshal(metadata, &meta)
			audit = append(audit, gin.H{
				"action": action, "actor_email": actor, "config_version": nullInt64Ptr(version),
				"success": success, "metadata": meta, "created_at": created,
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"versions": versions, "audit": audit}})
	}
}

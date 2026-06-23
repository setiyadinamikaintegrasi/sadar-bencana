package http

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	defaultFallbackBriefingSummary = "Briefing module not yet active"
	mastraWorkflowPath             = "/workflows/dailyBriefingWorkflow"
	mastraRecordSeparator          = byte(0x1e)
	mastraCreateRunTimeout         = 15 * time.Second
)

type sseStatusPayload struct {
	Stage   string `json:"stage"`
	Message string `json:"message"`
	RunID   string `json:"runId"`
	Mode    string `json:"mode,omitempty"`
}

type ssePartialPayload struct {
	Content string `json:"content"`
	RunID   string `json:"runId"`
	Mode    string `json:"mode"`
}

type sseFinalPayload struct {
	Content string `json:"content"`
	RunID   string `json:"runId"`
	Mode    string `json:"mode"`
	Note    string `json:"note"`
}

type sseErrorPayload struct {
	Message string `json:"message"`
	RunID   string `json:"runId,omitempty"`
}

type sseDonePayload struct {
	RunID string `json:"runId"`
	Mode  string `json:"mode"`
}

type mastraStreamEnvelope struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
	Meta    map[string]any `json:"meta,omitempty"`
}

type briefingFallbackData struct {
	Briefing briefingFallbackBriefing
	Alerts   []Alert
	Risks    []RiskScore
}

type briefingFallbackBriefing struct {
	Date       string
	Summary    string
	EventCount int
	TopEvents  []TopEvent
}

// AIExecutiveBriefingStream proxies the Mastra daily briefing workflow as a
// normalized SSE endpoint for the frontend.
func AIExecutiveBriefingStream(db *sql.DB, mastraBaseURL string, aiBriefingTimeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		triggerWorkerRefresh, err := parseOptionalBool(c.Query("triggerWorkerRefresh"), false)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "invalid_trigger_worker_refresh",
				"message": "query parameter 'triggerWorkerRefresh' must be true or false",
			})
			return
		}

		runID, err := newRunID()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "run_id_generation_failed",
				"message": err.Error(),
			})
			return
		}

		w := c.Writer
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			emitSSE(c, "error", sseErrorPayload{Message: "streaming is not supported by the server", RunID: runID})
			return
		}

		emitSSE(c, "status", sseStatusPayload{
			Stage:   "initializing",
			Message: "Creating AI workflow run",
			RunID:   runID,
			Mode:    "ai",
		})
		flusher.Flush()

		if err := createMastraRun(c.Request.Context(), mastraBaseURL, runID); err != nil {
			handleBriefingFallback(c, flusher, db, runID, fmt.Sprintf("failed to create Mastra run: %v", err))
			return
		}

		emitSSE(c, "status", sseStatusPayload{
			Stage:   "streaming",
			Message: "Streaming executive briefing workflow",
			RunID:   runID,
			Mode:    "ai",
		})
		flusher.Flush()

		content, streamErr := streamMastraBriefing(c.Request.Context(), mastraBaseURL, aiBriefingTimeout, runID, triggerWorkerRefresh, func(stage, message string) {
			emitSSE(c, "status", sseStatusPayload{
				Stage:   stage,
				Message: message,
				RunID:   runID,
				Mode:    "ai",
			})
			flusher.Flush()
		}, func(content string) {
			emitSSE(c, "partial", ssePartialPayload{
				Content: content,
				RunID:   runID,
				Mode:    "ai",
			})
			flusher.Flush()
		})
		if streamErr != nil || strings.TrimSpace(content) == "" {
			reason := "workflow Mastra tidak mengembalikan hasil yang bisa dipakai"
			if streamErr != nil {
				reason = normalizeBriefingFailure(streamErr, aiBriefingTimeout)
			}
			handleBriefingFallback(c, flusher, db, runID, reason)
			return
		}

		note := "Dihasilkan oleh workflow Mastra + local LLM."
		emitSSE(c, "final", sseFinalPayload{
			Content: content,
			RunID:   runID,
			Mode:    "ai",
			Note:    note,
		})
		emitSSE(c, "done", sseDonePayload{RunID: runID, Mode: "ai"})
		flusher.Flush()
	}
}

func handleBriefingFallback(c *gin.Context, flusher http.Flusher, db *sql.DB, runID, reason string) {
	emitSSE(c, "status", sseStatusPayload{
		Stage:   "fallback",
		Message: fmt.Sprintf("AI path unavailable, switching to deterministic fallback: %s", reason),
		RunID:   runID,
		Mode:    "fallback",
	})
	flusher.Flush()

	if db == nil {
		emitSSE(c, "error", sseErrorPayload{
			Message: "database is unavailable; deterministic fallback cannot be generated",
			RunID:   runID,
		})
		flusher.Flush()
		return
	}

	fallbackData, err := loadBriefingFallbackData(c.Request.Context(), db)
	if err != nil {
		emitSSE(c, "error", sseErrorPayload{
			Message: fmt.Sprintf("failed to build deterministic fallback: %v", err),
			RunID:   runID,
		})
		flusher.Flush()
		return
	}

	content := buildDeterministicBriefing(fallbackData.Briefing, fallbackData.Alerts, fallbackData.Risks, reason)
	note := fmt.Sprintf("Fallback aktif: %s.", reason)

	emitSSE(c, "partial", ssePartialPayload{
		Content: content,
		RunID:   runID,
		Mode:    "fallback",
	})
	emitSSE(c, "final", sseFinalPayload{
		Content: content,
		RunID:   runID,
		Mode:    "fallback",
		Note:    note,
	})
	emitSSE(c, "done", sseDonePayload{RunID: runID, Mode: "fallback"})
	flusher.Flush()
}

func createMastraRun(parent context.Context, mastraBaseURL, runID string) error {
	ctx, cancel := context.WithTimeout(parent, mastraCreateRunTimeout)
	defer cancel()

	endpoint, err := buildMastraURL(mastraBaseURL, mastraWorkflowPath+"/create-run", map[string]string{"runId": runID})
	if err != nil {
		return err
	}

	body := strings.NewReader(`{}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("mastra create-run returned status %d: %s", res.StatusCode, readResponseSnippet(res.Body))
	}

	return nil
}

func streamMastraBriefing(
	parent context.Context,
	mastraBaseURL string,
	aiBriefingTimeout time.Duration,
	runID string,
	triggerWorkerRefresh bool,
	onStatus func(stage, message string),
	onPartial func(content string),
) (string, error) {
	ctx, cancel := context.WithTimeout(parent, aiBriefingTimeout)
	defer cancel()

	endpoint, err := buildMastraURL(mastraBaseURL, mastraWorkflowPath+"/stream", map[string]string{"runId": runID})
	if err != nil {
		return "", err
	}

	payload := map[string]any{
		"inputData": map[string]any{
			"triggerWorkerRefresh": triggerWorkerRefresh,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("mastra stream returned status %d: %s", res.StatusCode, readResponseSnippet(res.Body))
	}

	var buffer []byte
	var lastPartial string
	var finalContent string
	var sawWorkflowDone bool
	var sawAnyEvent bool

	chunk := make([]byte, 4096)
	for {
		n, readErr := res.Body.Read(chunk)
		if n > 0 {
			buffer = append(buffer, chunk[:n]...)
			for {
				idx := bytes.IndexByte(buffer, mastraRecordSeparator)
				if idx < 0 {
					break
				}

				raw := bytes.TrimSpace(buffer[:idx])
				buffer = buffer[idx+1:]
				if len(raw) == 0 {
					continue
				}

				sawAnyEvent = true
				event, parseErr := parseMastraEnvelope(raw)
				if parseErr != nil {
					continue
				}

				stage, message := mapMastraStatus(event)
				if stage != "" && message != "" {
					onStatus(stage, message)
				}

				if partial := extractMastraPartial(event); partial != "" && partial != lastPartial {
					lastPartial = partial
					onPartial(partial)
				}

				if briefing := extractMastraBriefing(event); briefing != "" {
					finalContent = briefing
				}

				if event.Type == "workflow-finished" || event.Type == "workflow-complete" {
					sawWorkflowDone = true
				}
			}
		}

		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			if errors.Is(readErr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return finalContent, context.DeadlineExceeded
			}
			if ctx.Err() != nil {
				return finalContent, ctx.Err()
			}
			return finalContent, readErr
		}
	}

	if len(bytes.TrimSpace(buffer)) > 0 {
		event, parseErr := parseMastraEnvelope(bytes.TrimSpace(buffer))
		if parseErr == nil {
			sawAnyEvent = true
			if stage, message := mapMastraStatus(event); stage != "" && message != "" {
				onStatus(stage, message)
			}
			if partial := extractMastraPartial(event); partial != "" && partial != lastPartial {
				onPartial(partial)
			}
			if briefing := extractMastraBriefing(event); briefing != "" {
				finalContent = briefing
			}
		}
	}

	if ctx.Err() != nil {
		return finalContent, ctx.Err()
	}
	if !sawAnyEvent {
		return finalContent, errors.New("workflow stream returned no events")
	}
	if strings.TrimSpace(finalContent) == "" && !sawWorkflowDone {
		return finalContent, errors.New("workflow ended before final briefing step completed")
	}

	return strings.TrimSpace(finalContent), nil
}

func parseMastraEnvelope(raw []byte) (mastraStreamEnvelope, error) {
	var event mastraStreamEnvelope
	if err := json.Unmarshal(raw, &event); err != nil {
		return mastraStreamEnvelope{}, err
	}
	return event, nil
}

func mapMastraStatus(event mastraStreamEnvelope) (string, string) {
	stepID, _ := event.Payload["id"].(string)

	switch {
	case event.Type == "workflow-start":
		return "workflow", "Workflow started"
	case event.Type == "workflow-step-start" && stepID == "gather-dashboard-context":
		return "context", "Gathering dashboard context"
	case event.Type == "workflow-step-start" && stepID == "generate-executive-briefing":
		return "generation", "Generating executive briefing"
	case event.Type == "workflow-step-result" && stepID == "gather-dashboard-context":
		return "context_ready", "Dashboard context prepared"
	case event.Type == "workflow-step-result" && stepID == "generate-executive-briefing":
		return "generation_complete", "Executive briefing generated"
	case event.Type == "workflow-finished" || event.Type == "workflow-complete":
		return "workflow_complete", "Workflow finished"
	case event.Type == "workflow-error":
		if message := extractMastraError(event); message != "" {
			return "workflow_error", message
		}
	}

	return "", ""
}

func extractMastraBriefing(event mastraStreamEnvelope) string {
	if event.Type != "workflow-step-result" {
		return ""
	}

	stepID, _ := event.Payload["id"].(string)
	if stepID != "generate-executive-briefing" {
		return ""
	}

	output, ok := event.Payload["output"].(map[string]any)
	if !ok {
		return ""
	}
	briefing, _ := output["briefing"].(string)
	return strings.TrimSpace(briefing)
}

func extractMastraPartial(event mastraStreamEnvelope) string {
	fields := []string{"delta", "text", "content"}
	for _, field := range fields {
		if text := anyToString(event.Payload[field]); text != "" {
			return text
		}
	}

	if output, ok := event.Payload["output"].(map[string]any); ok {
		for _, field := range fields {
			if text := anyToString(output[field]); text != "" {
				return text
			}
		}
	}

	return ""
}

func extractMastraError(event mastraStreamEnvelope) string {
	if message := anyToString(event.Payload["message"]); message != "" {
		return message
	}
	if errVal := anyToString(event.Payload["error"]); errVal != "" {
		return errVal
	}
	return ""
}

func buildDeterministicBriefing(briefing briefingFallbackBriefing, alerts []Alert, riskScores []RiskScore, reason string) string {
	topEvents := briefing.TopEvents
	if len(topEvents) > 3 {
		topEvents = topEvents[:3]
	}
	topAlerts := alerts
	if len(topAlerts) > 3 {
		topAlerts = topAlerts[:3]
	}
	topRisks := riskScores
	if len(topRisks) > 3 {
		topRisks = topRisks[:3]
	}

	lines := []string{
		"Ringkasan situasi",
		briefing.Summary,
		"",
		"Top risk movers",
	}

	if len(topEvents) > 0 {
		for idx, event := range topEvents {
			place := "Lokasi belum tersedia"
			if event.Place != nil && strings.TrimSpace(*event.Place) != "" {
				place = strings.TrimSpace(*event.Place)
			}
			source := "n/a"
			if event.Source != nil && strings.TrimSpace(*event.Source) != "" {
				source = strings.TrimSpace(*event.Source)
			}
			lines = append(lines, fmt.Sprintf("%d. %s — event_id %s · source %s · M%.1f", idx+1, place, event.EventID, source, event.Magnitude))
		}
	} else {
		lines = append(lines, "1. Tidak ada top event pada briefing hari ini.")
	}

	lines = append(lines, "", "Probable impact")
	if len(topRisks) > 0 {
		for idx, risk := range topRisks {
			place := strings.TrimSpace(stringValue(risk.Place, "Lokasi belum tersedia"))
			source := strings.TrimSpace(stringValue(risk.Source, "n/a"))
			severity := "n/a"
			if parsed := parseRiskSeverity(risk.Factors); parsed != "" {
				severity = parsed
			}
			lines = append(lines, fmt.Sprintf("%d. %s — event_id %s · source %s · score %.2f · severity %s", idx+1, place, risk.EntityID, source, risk.Score, severity))
		}
	} else {
		lines = append(lines, "1. Risk score belum tersedia dari endpoint saat ini.")
	}

	lines = append(lines, "", "Recommended follow-up actions")
	if len(topAlerts) > 0 {
		for idx, alert := range topAlerts {
			line := fmt.Sprintf("%d. Tinjau alert %s (%s)", idx+1, alert.ID, alert.Severity)
			if alert.Source != nil && strings.TrimSpace(*alert.Source) != "" {
				line += fmt.Sprintf(" · source %s", strings.TrimSpace(*alert.Source))
			}
			if alert.EventID != nil && strings.TrimSpace(*alert.EventID) != "" {
				line += fmt.Sprintf(" · event_id %s", strings.TrimSpace(*alert.EventID))
			}
			if alert.Message != nil && strings.TrimSpace(*alert.Message) != "" {
				line += fmt.Sprintf(" — %s", strings.TrimSpace(*alert.Message))
			}
			lines = append(lines, line)
		}
	} else {
		lines = append(lines, "1. Tidak ada alert prioritas yang perlu ditindaklanjuti saat ini.")
	}

	lines = append(lines, "", fmt.Sprintf("Catatan fallback: %s", reason))
	return strings.Join(lines, "\n")
}

func loadBriefingFallbackData(ctx context.Context, db *sql.DB) (briefingFallbackData, error) {
	briefing, err := loadLatestBriefing(ctx, db)
	if err != nil {
		return briefingFallbackData{}, err
	}
	alerts, err := loadFallbackAlerts(ctx, db)
	if err != nil {
		return briefingFallbackData{}, err
	}
	risks, err := loadFallbackRiskScores(ctx, db)
	if err != nil {
		return briefingFallbackData{}, err
	}

	return briefingFallbackData{
		Briefing: briefing,
		Alerts:   alerts,
		Risks:    risks,
	}, nil
}

func loadLatestBriefing(ctx context.Context, db *sql.DB) (briefingFallbackBriefing, error) {
	today := time.Now().UTC().Format("2006-01-02")

	var briefingID string
	var summary string
	var eventCount int
	var createdAt time.Time
	err := db.QueryRowContext(ctx, latestBriefingQuery).Scan(&briefingID, &summary, &eventCount, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return briefingFallbackBriefing{
				Date:       today,
				Summary:    defaultFallbackBriefingSummary,
				EventCount: 0,
				TopEvents:  []TopEvent{},
			}, nil
		}
		return briefingFallbackBriefing{}, err
	}

	rows, err := db.QueryContext(ctx, briefingTopEventsQuery, briefingID)
	if err != nil {
		return briefingFallbackBriefing{}, err
	}
	defer rows.Close()

	topEvents := make([]TopEvent, 0, 3)
	for rows.Next() {
		var te TopEvent
		var place, source sql.NullString
		var magnitude sql.NullFloat64
		if err := rows.Scan(&te.EventID, &magnitude, &place, &source); err != nil {
			return briefingFallbackBriefing{}, err
		}
		if magnitude.Valid {
			te.Magnitude = magnitude.Float64
		}
		te.Place = nullStringPtr(place)
		te.Source = nullStringPtr(source)
		topEvents = append(topEvents, te)
	}
	if err := rows.Err(); err != nil {
		return briefingFallbackBriefing{}, err
	}

	return briefingFallbackBriefing{
		Date:       createdAt.UTC().Format("2006-01-02"),
		Summary:    summary,
		EventCount: eventCount,
		TopEvents:  topEvents,
	}, nil
}

func loadFallbackAlerts(ctx context.Context, db *sql.DB) ([]Alert, error) {
	rows, err := db.QueryContext(ctx, alertsQuery, nil)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	alerts := make([]Alert, 0, 3)
	for rows.Next() {
		var alert Alert
		var eventUUID, eventID, source, place, message sql.NullString
		var magnitude sql.NullFloat64
		var eventTime sql.NullTime
		if err := rows.Scan(
			&alert.ID,
			&eventUUID,
			&eventID,
			&source,
			&place,
			&magnitude,
			&eventTime,
			&alert.AlertType,
			&alert.Severity,
			&message,
			&alert.Acknowledged,
			&alert.CreatedAt,
		); err != nil {
			return nil, err
		}
		alert.EventUUID = nullStringPtr(eventUUID)
		alert.EventID = nullStringPtr(eventID)
		alert.Source = nullStringPtr(source)
		alert.Place = nullStringPtr(place)
		alert.Magnitude = nullFloat64Ptr(magnitude)
		alert.Message = nullStringPtr(message)
		if eventTime.Valid {
			alert.EventTime = &eventTime.Time
		}
		alerts = append(alerts, alert)
		if len(alerts) == 3 {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return alerts, nil
}

func loadFallbackRiskScores(ctx context.Context, db *sql.DB) ([]RiskScore, error) {
	rows, err := db.QueryContext(ctx, riskScoresQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	scores := make([]RiskScore, 0, 3)
	for rows.Next() {
		var rs RiskScore
		var factors []byte
		var place, source sql.NullString
		var magnitude sql.NullFloat64
		if err := rows.Scan(&rs.EntityID, &rs.Score, &factors, &rs.CalculatedAt, &place, &magnitude, &source); err != nil {
			return nil, err
		}
		rs.Factors = json.RawMessage(factors)
		rs.Place = nullStringPtr(place)
		rs.Magnitude = nullFloat64Ptr(magnitude)
		rs.Source = nullStringPtr(source)
		scores = append(scores, rs)
		if len(scores) == 3 {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return scores, nil
}

func emitSSE(c *gin.Context, event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		fallback, _ := json.Marshal(sseErrorPayload{Message: err.Error()})
		_, _ = fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", fallback)
		return
	}
	_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
}

func buildMastraURL(baseURL, path string, query map[string]string) (string, error) {
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", err
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	values := base.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	base.RawQuery = values.Encode()
	return base.String(), nil
}

func readResponseSnippet(r io.Reader) string {
	body, err := io.ReadAll(io.LimitReader(r, 2048))
	if err != nil {
		return "unable to read response body"
	}
	return strings.TrimSpace(string(body))
}

func normalizeBriefingFailure(err error, timeout time.Duration) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Sprintf("local LLM melewati batas waktu %d detik", int(timeout/time.Second))
	case err != nil:
		return err.Error()
	default:
		return "workflow Mastra tidak mengembalikan hasil yang bisa dipakai"
	}
}

func parseRiskSeverity(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	severity, _ := payload["severity"].(string)
	return strings.TrimSpace(severity)
}

func stringValue(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return *value
}

func anyToString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			if s := anyToString(item); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	case map[string]any:
		for _, key := range []string{"text", "content", "value"} {
			if s := anyToString(v[key]); s != "" {
				return s
			}
		}
	}
	return ""
}

func parseOptionalBool(raw string, fallback bool) (bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, err
	}
	return value, nil
}

func newRunID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

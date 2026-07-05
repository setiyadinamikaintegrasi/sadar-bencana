package http

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// CopilotQueryRequest is the JSON body expected from the frontend.
type CopilotQueryRequest struct {
	Message string `json:"message" binding:"required"`
}

// CopilotEvent is a single SSE event forwarded from Mastra's chatRoute.
type CopilotEvent struct {
	Type string          `json:"type,omitempty"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// AICopilotChat proxies a chat request to the Mastra analyst-copilot-agent
// and streams the AI SDK-compatible SSE response back to the frontend.
func AICopilotChat(
	db *sql.DB,
	mastraBaseURL, mastraAPIToken string,
	timeout time.Duration,
	limits AIUsageLimits,
	maxPromptCharacters int,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CopilotQueryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad request: message is required"})
			return
		}
		req.Message = strings.TrimSpace(req.Message)
		if req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad request: message is required"})
			return
		}
		if maxPromptCharacters > 0 && utf8.RuneCountInString(req.Message) > maxPromptCharacters {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error":          "ai_prompt_too_long",
				"message":        "Pesan Copilot terlalu panjang.",
				"max_characters": maxPromptCharacters,
			})
			return
		}

		lease, ok := acquireAIUsage(c, db, "copilot", limits)
		if !ok {
			return
		}
		completed := false
		defer func() {
			status := "failed"
			responseStatus := c.Writer.Status()
			if completed {
				status = "completed"
			}
			lease.Finish(context.Background(), status, responseStatus)
		}()

		ctx := c.Request.Context()

		// Construct the Mastra chat endpoint for the analyst-copilot-agent
		mastraURL := mastraBaseURL + "/chat/analyst-copilot-agent"

		// Build the AI SDK v5 compatible request body
		bodyPayload := map[string]any{
			"messages": []map[string]any{
				{
					"role":    "user",
					"content": req.Message,
				},
			},
		}
		bodyBytes, err := json.Marshal(bodyPayload)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to serialize request"})
			return
		}

		// Forward to Mastra with timeout
		mastraReq, err := http.NewRequestWithContext(ctx, http.MethodPost, mastraURL, bytes.NewReader(bodyBytes))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create Mastra request"})
			return
		}
		mastraReq.Header.Set("Content-Type", "application/json")
		setInternalBearer(mastraReq, mastraAPIToken)

		client := &http.Client{Timeout: timeout}
		res, err := client.Do(mastraReq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Mastra unreachable: " + err.Error()})
			return
		}
		defer res.Body.Close()

		if res.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(res.Body)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Mastra returned " + res.Status, "detail": string(body)})
			return
		}

		// Stream Mastra's response body (AI SDK SSE format) back to frontend as-is
		w := c.Writer
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		h.Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
			return
		}

		// We proxy the raw SSE data from Mastra directly.
		// The Mastra chatRoute emits AI SDK v5 compatible events with "0:" text chunks and "d:" data events.
		// The frontend can consume these using @ai-sdk/react useChat() with DefaultChatTransport
		// or parse the raw events manually.
		buf := make([]byte, 4096)
		for {
			n, readErr := res.Body.Read(buf)
			if n > 0 {
				if _, writeErr := w.Write(buf[:n]); writeErr != nil {
					return
				}
				flusher.Flush()
			}
			if readErr != nil {
				if readErr == io.EOF {
					completed = true
				}
				return
			}
		}
	}
}

package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestAICopilotChatRejectsOversizedPromptBeforeUpstreamCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/copilot", AICopilotChat(
		nil, "http://unused", "unused", time.Second, AIUsageLimits{}, 5,
	))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/copilot",
		strings.NewReader(`{"message":"123456"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s, want 413", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"ai_prompt_too_long"`) {
		t.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}

func TestAICopilotChatRejectsWhitespacePrompt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/copilot", AICopilotChat(
		nil, "http://unused", "unused", time.Second, AIUsageLimits{}, 2000,
	))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/copilot",
		strings.NewReader(`{"message":"   "}`),
	)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, want 400", recorder.Code, recorder.Body.String())
	}
}

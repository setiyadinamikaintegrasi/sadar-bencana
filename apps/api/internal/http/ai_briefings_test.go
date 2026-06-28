package http

import (
	"context"
	"errors"
	"fmt"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCreateMastraRunUsesDailyBriefingWorkflowPath(t *testing.T) {
	var requestedPath atomic.Value
	server := httptest.NewServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		requestedPath.Store(r.URL.Path + "?" + r.URL.RawQuery)
		if r.URL.Path != "/api/workflows/daily-briefing-workflow/create-run" {
			t.Fatalf("unexpected create-run path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("runId"); got != "run-123" {
			t.Fatalf("unexpected runId: %s", got)
		}
		w.WriteHeader(stdhttp.StatusOK)
	}))
	defer server.Close()

	if err := createMastraRun(context.Background(), server.URL, "run-123"); err != nil {
		t.Fatalf("createMastraRun returned error: %v", err)
	}

	if got, _ := requestedPath.Load().(string); !strings.HasPrefix(got, "/api/workflows/daily-briefing-workflow/create-run?") {
		t.Fatalf("unexpected requested path: %q", got)
	}
}

func TestStreamMastraBriefingUsesWorkflowPathAndReturnsBriefing(t *testing.T) {
	var streamHits atomic.Int32
	server := httptest.NewServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		switch r.URL.Path {
		case "/api/workflows/daily-briefing-workflow/stream":
			streamHits.Add(1)
			if got := r.URL.Query().Get("runId"); got != "run-456" {
				t.Fatalf("unexpected runId: %s", got)
			}
			w.WriteHeader(stdhttp.StatusOK)
			_, _ = fmt.Fprintf(w, `{"type":"workflow-start","payload":{}}%c`, mastraRecordSeparator)
			_, _ = fmt.Fprintf(w, `{"type":"workflow-step-result","payload":{"id":"gather-dashboard-context","output":{"content":"ctx ready"}}}%c`, mastraRecordSeparator)
			_, _ = fmt.Fprintf(w, `{"type":"workflow-step-result","payload":{"id":"generate-executive-briefing","output":{"briefing":"Briefing AI final"}}}%c`, mastraRecordSeparator)
			_, _ = fmt.Fprintf(w, `{"type":"workflow-finished","payload":{}}%c`, mastraRecordSeparator)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var statuses []string
	var partials []string
	briefing, err := streamMastraBriefing(
		context.Background(),
		server.URL,
		2*time.Second,
		"run-456",
		false,
		func(stage, message string) { statuses = append(statuses, stage+":"+message) },
		func(content string) { partials = append(partials, content) },
	)
	if err != nil {
		t.Fatalf("streamMastraBriefing returned error: %v", err)
	}
	if briefing != "Briefing AI final" {
		t.Fatalf("unexpected briefing: %q", briefing)
	}
	if streamHits.Load() != 1 {
		t.Fatalf("expected stream endpoint to be hit once, got %d", streamHits.Load())
	}
	if len(statuses) == 0 {
		t.Fatal("expected status callbacks to be invoked")
	}
	if len(partials) == 0 || partials[0] != "ctx ready" {
		t.Fatalf("unexpected partials: %#v", partials)
	}
}

func TestStreamMastraBriefingHonorsTimeout(t *testing.T) {
	server := httptest.NewServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if r.URL.Path != "/api/workflows/daily-briefing-workflow/stream" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		time.Sleep(80 * time.Millisecond)
		w.WriteHeader(stdhttp.StatusOK)
	}))
	defer server.Close()

	_, err := streamMastraBriefing(
		context.Background(),
		server.URL,
		20*time.Millisecond,
		"run-timeout",
		false,
		func(stage, message string) {},
		func(content string) {},
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context deadline exceeded, got: %v", err)
	}
}

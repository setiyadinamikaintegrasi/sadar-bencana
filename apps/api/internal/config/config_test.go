package config

import (
	"testing"
	"time"
)

func TestLoadUsesUpdatedDefaultAIBriefingTimeout(t *testing.T) {
	t.Setenv("AI_BRIEFING_TIMEOUT", "")

	cfg := Load()
	if cfg.AIBriefingTimeout != 150*time.Second {
		t.Fatalf("expected default AI briefing timeout 150s, got %s", cfg.AIBriefingTimeout)
	}
}

package config

import (
	"os"
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

func TestRiskFreeLimit_DefaultZero(t *testing.T) {
	os.Unsetenv("RISK_FREE_LIMIT")
	if got := Load().RiskFreeLimit; got != 0 {
		t.Fatalf("default RiskFreeLimit = %d, want 0", got)
	}
}

func TestRiskFreeLimit_FromEnv(t *testing.T) {
	os.Setenv("RISK_FREE_LIMIT", "5")
	defer os.Unsetenv("RISK_FREE_LIMIT")
	if got := Load().RiskFreeLimit; got != 5 {
		t.Fatalf("RiskFreeLimit = %d, want 5", got)
	}
}

func TestRiskFreeLimit_InvalidFallsBackToZero(t *testing.T) {
	os.Setenv("RISK_FREE_LIMIT", "abc")
	defer os.Unsetenv("RISK_FREE_LIMIT")
	if got := Load().RiskFreeLimit; got != 0 {
		t.Fatalf("RiskFreeLimit invalid = %d, want 0", got)
	}
}

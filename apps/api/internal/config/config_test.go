package config

import (
	"os"
	"strings"
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

func TestDeploymentDefaultsToCommunityWithTwentyPersonalAssets(t *testing.T) {
	t.Setenv("DEPLOYMENT_MODE", "")
	t.Setenv("PERSONAL_ASSET_LIMIT", "")
	cfg := Load()
	if cfg.DeploymentMode != "community" {
		t.Fatalf("DeploymentMode = %q, want community", cfg.DeploymentMode)
	}
	if cfg.PersonalAssetLimit != 20 {
		t.Fatalf("PersonalAssetLimit = %d, want 20", cfg.PersonalAssetLimit)
	}
}

func TestValidateSecurityRequiresDistinctStrongTokensOutsideLocal(t *testing.T) {
	cfg := Config{
		Env:            "hosted",
		WorkerAPIToken: "w",
		MastraAPIToken: "m",
		TrustedProxies: []string{"127.0.0.1/32", "172.16.0.0/12"},
	}
	if err := cfg.ValidateSecurity(); err == nil {
		t.Fatal("expected weak production tokens to be rejected")
	}

	cfg.WorkerAPIToken = "w" + strings.Repeat("1", 31)
	cfg.MastraAPIToken = cfg.WorkerAPIToken
	if err := cfg.ValidateSecurity(); err == nil {
		t.Fatal("expected reused internal token to be rejected")
	}

	cfg.MastraAPIToken = "m" + strings.Repeat("2", 31)
	if err := cfg.ValidateSecurity(); err != nil {
		t.Fatalf("expected distinct strong tokens to pass: %v", err)
	}
}

func TestValidateSecurityRequiresExplicitNarrowTrustedProxies(t *testing.T) {
	cfg := Config{
		Env:            "hosted",
		WorkerAPIToken: "w" + strings.Repeat("1", 31),
		MastraAPIToken: "m" + strings.Repeat("2", 31),
	}
	if err := cfg.ValidateSecurity(); err == nil {
		t.Fatal("expected empty production trusted proxy list to be rejected")
	}

	for _, wildcard := range []string{"*", "0.0.0.0/0", "::/0"} {
		cfg.TrustedProxies = []string{wildcard}
		if err := cfg.ValidateSecurity(); err == nil {
			t.Fatalf("expected wildcard trusted proxy %q to be rejected", wildcard)
		}
	}

	cfg.TrustedProxies = []string{"127.0.0.1/32", "172.16.0.0/12"}
	if err := cfg.ValidateSecurity(); err != nil {
		t.Fatalf("expected narrow trusted proxies to pass: %v", err)
	}
}

func TestLoadParsesTrustedProxyList(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", " 127.0.0.1/32, 172.16.0.0/12 ,, ::1/128 ")

	got := Load().TrustedProxies
	want := []string{"127.0.0.1/32", "172.16.0.0/12", "::1/128"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("TrustedProxies = %#v, want %#v", got, want)
	}
}

func TestValidateSecurityAllowsTokenlessLocalDevelopment(t *testing.T) {
	if err := (Config{Env: "local"}).ValidateSecurity(); err != nil {
		t.Fatalf("local development should not require internal tokens: %v", err)
	}
}

func TestIsProductionRuntime(t *testing.T) {
	for _, env := range []string{"production", "hosted", "docker", " HOSTED "} {
		if !(Config{Env: env}).IsProductionRuntime() {
			t.Fatalf("expected %q to be a production runtime", env)
		}
	}
	for _, env := range []string{"", "local", "development", "test"} {
		if (Config{Env: env}).IsProductionRuntime() {
			t.Fatalf("expected %q not to be a production runtime", env)
		}
	}
}

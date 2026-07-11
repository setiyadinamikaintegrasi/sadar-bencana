package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Host                      string
	Port                      string
	Env                       string
	DatabaseURL               string
	MastraBaseURL             string
	MastraAPIToken            string
	WorkerBaseURL             string
	WorkerAPIToken            string
	SupabaseJWTSecret         string
	SupabaseJWKSURL           string
	RiskFreeLimit             int
	AIBriefingTimeout         time.Duration
	AIExecutiveCacheTTL       time.Duration
	AIExecutivePerMinute      int
	AIExecutivePerDay         int
	AIExecutiveGlobalPerDay   int
	AICopilotPerMinute        int
	AICopilotPerDay           int
	AICopilotGlobalPerMinute  int
	AICopilotGlobalPerDay     int
	AICopilotMaxCharacters    int
	OfficialSourceSettingsKey string
	DeploymentMode            string
	PersonalAssetLimit        int
	EntitlementPublicKey      string
	GeocoderBaseURL           string
	GeocoderUserAgent         string
	SMTPHost                  string
	SMTPPort                  string
	SMTPUser                  string
	SMTPPassword              string
	SMTPFrom                  string
	TrustedProxies            []string
	SupabaseURL               string
	SupabaseServiceRoleKey    string
}

func Load() Config {
	return Config{
		Host:                      getEnv("API_HOST", "0.0.0.0"),
		Port:                      getEnv("API_PORT", "8001"),
		Env:                       getEnv("API_ENV", "local"),
		DatabaseURL:               os.Getenv("DATABASE_URL"),
		MastraBaseURL:             getEnv("MASTRA_BASE_URL", "http://127.0.0.1:4111"),
		MastraAPIToken:            getEnv("MASTRA_API_TOKEN", ""),
		WorkerBaseURL:             getEnv("WORKER_BASE_URL", "http://127.0.0.1:8002"),
		WorkerAPIToken:            getEnv("WORKER_API_TOKEN", ""),
		SupabaseJWTSecret:         getEnv("SUPABASE_JWT_SECRET", ""),
		SupabaseJWKSURL:           supabaseJWKSURL(),
		RiskFreeLimit:             getEnvInt("RISK_FREE_LIMIT", 0),
		AIBriefingTimeout:         getEnvDuration("AI_BRIEFING_TIMEOUT", 150*time.Second),
		AIExecutiveCacheTTL:       getEnvDuration("AI_EXECUTIVE_CACHE_TTL", 6*time.Hour),
		AIExecutivePerMinute:      getEnvInt("AI_EXECUTIVE_PER_MINUTE", 2),
		AIExecutivePerDay:         getEnvInt("AI_EXECUTIVE_PER_DAY", 3),
		AIExecutiveGlobalPerDay:   getEnvInt("AI_EXECUTIVE_GLOBAL_PER_DAY", 20),
		AICopilotPerMinute:        getEnvInt("AI_COPILOT_PER_MINUTE", 5),
		AICopilotPerDay:           getEnvInt("AI_COPILOT_PER_DAY", 10),
		AICopilotGlobalPerMinute:  getEnvInt("AI_COPILOT_GLOBAL_PER_MINUTE", 30),
		AICopilotGlobalPerDay:     getEnvInt("AI_COPILOT_GLOBAL_PER_DAY", 100),
		AICopilotMaxCharacters:    getEnvInt("AI_COPILOT_MAX_CHARACTERS", 2000),
		OfficialSourceSettingsKey: getEnv("OFFICIAL_SOURCE_SETTINGS_KEY", ""),
		DeploymentMode:            getEnv("DEPLOYMENT_MODE", "community"),
		PersonalAssetLimit:        getEnvInt("PERSONAL_ASSET_LIMIT", 20),
		EntitlementPublicKey:      getEnv("ENTITLEMENT_PUBLIC_KEY", ""),
		GeocoderBaseURL:           getEnv("GEOCODER_BASE_URL", "https://nominatim.openstreetmap.org"),
		GeocoderUserAgent:         getEnv("GEOCODER_USER_AGENT", "SadarBencana/0.1 (https://sadarbencana.id)"),
		SMTPHost:                  getEnv("SMTP_HOST", ""),
		SMTPPort:                  getEnv("SMTP_PORT", "587"),
		SMTPUser:                  getEnv("SMTP_USER", ""),
		SMTPPassword:              getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:                  getEnv("SMTP_FROM", "noreply@sadarbencana.id"),
		TrustedProxies:            getEnvList("TRUSTED_PROXIES"),
		SupabaseURL:               getEnv("SUPABASE_URL", ""),
		SupabaseServiceRoleKey:    getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
	}
}

// ValidateSecurity rejects production configurations that would leave
// internal service-to-service APIs unauthenticated.
func (cfg Config) ValidateSecurity() error {
	if !cfg.IsProductionRuntime() {
		return nil
	}
	if len(strings.TrimSpace(cfg.WorkerAPIToken)) < 32 {
		return fmt.Errorf("WORKER_API_TOKEN must contain at least 32 characters")
	}
	if len(strings.TrimSpace(cfg.MastraAPIToken)) < 32 {
		return fmt.Errorf("MASTRA_API_TOKEN must contain at least 32 characters")
	}
	if cfg.WorkerAPIToken == cfg.MastraAPIToken {
		return fmt.Errorf("WORKER_API_TOKEN and MASTRA_API_TOKEN must use different values")
	}
	if len(cfg.TrustedProxies) == 0 {
		return fmt.Errorf("TRUSTED_PROXIES must contain at least one explicit proxy address or CIDR")
	}
	for _, proxy := range cfg.TrustedProxies {
		switch strings.ToLower(strings.TrimSpace(proxy)) {
		case "*", "0.0.0.0", "0.0.0.0/0", "::", "::/0":
			return fmt.Errorf("TRUSTED_PROXIES must not trust all addresses")
		}
	}
	return nil
}

// IsProductionRuntime identifies environments that must use fail-closed
// security defaults and production-safe framework settings.
func (cfg Config) IsProductionRuntime() bool {
	switch strings.ToLower(strings.TrimSpace(cfg.Env)) {
	case "production", "hosted", "docker":
		return true
	default:
		return false
	}
}

// supabaseJWKSURL returns the JWKS endpoint used to verify asymmetric
// (ES256/RS256) Supabase access tokens. An explicit SUPABASE_JWKS_URL wins;
// otherwise it is derived from SUPABASE_URL. Empty when neither is set.
func supabaseJWKSURL() string {
	if explicit := os.Getenv("SUPABASE_JWKS_URL"); explicit != "" {
		return explicit
	}
	if base := os.Getenv("SUPABASE_URL"); base != "" {
		return strings.TrimRight(base, "/") + "/auth/v1/.well-known/jwks.json"
	}
	return ""
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}

func getEnvList(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}

	values := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}

	return parsed
}

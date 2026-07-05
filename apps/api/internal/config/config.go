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
	}
}

// ValidateSecurity rejects production configurations that would leave
// internal service-to-service APIs unauthenticated.
func (cfg Config) ValidateSecurity() error {
	env := strings.ToLower(strings.TrimSpace(cfg.Env))
	if env != "production" && env != "hosted" && env != "docker" {
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
	return nil
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

package config

import (
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
	WorkerBaseURL             string
	SupabaseJWTSecret         string
	SupabaseJWKSURL           string
	RiskFreeLimit             int
	AIBriefingTimeout         time.Duration
	OfficialSourceSettingsKey string
}

func Load() Config {
	return Config{
		Host:                      getEnv("API_HOST", "0.0.0.0"),
		Port:                      getEnv("API_PORT", "8001"),
		Env:                       getEnv("API_ENV", "local"),
		DatabaseURL:               os.Getenv("DATABASE_URL"),
		MastraBaseURL:             getEnv("MASTRA_BASE_URL", "http://127.0.0.1:4111"),
		WorkerBaseURL:             getEnv("WORKER_BASE_URL", "http://127.0.0.1:8002"),
		SupabaseJWTSecret:         getEnv("SUPABASE_JWT_SECRET", ""),
		SupabaseJWKSURL:           supabaseJWKSURL(),
		RiskFreeLimit:             getEnvInt("RISK_FREE_LIMIT", 0),
		AIBriefingTimeout:         getEnvDuration("AI_BRIEFING_TIMEOUT", 150*time.Second),
		OfficialSourceSettingsKey: getEnv("OFFICIAL_SOURCE_SETTINGS_KEY", ""),
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

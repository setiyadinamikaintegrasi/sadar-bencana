package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// defaultDatabaseURL is the local development PostgreSQL connection string.
// It is constructed from individual parts so the default credentials are
// explicit in source without hard-to-read escaping.
const (
	defaultPgUser = "sadar"
	defaultPgPass = "changeme"
	defaultPgHost = "localhost"
	defaultPgPort = "5433"
	defaultPgDB   = "sadar_bencana"
)

// DefaultDatabaseURL constructs the default DATABASE_URL used when the
// DATABASE_URL environment variable is not set.
func DefaultDatabaseURL() string {
	return "postgres://" + defaultPgUser + ":" + defaultPgPass + "@" + defaultPgHost + ":" + defaultPgPort + "/" + defaultPgDB
}

type Config struct {
	Host              string
	Port              string
	Env               string
	DatabaseURL       string
	MastraBaseURL     string
	SupabaseJWTSecret string
	SupabaseJWKSURL   string
	RiskFreeLimit     int
	AIBriefingTimeout time.Duration
}

func Load() Config {
	return Config{
		Host:              getEnv("API_HOST", "0.0.0.0"),
		Port:              getEnv("API_PORT", "8001"),
		Env:               getEnv("API_ENV", "local"),
		DatabaseURL:       getEnv("DATABASE_URL", DefaultDatabaseURL()),
		MastraBaseURL:     getEnv("MASTRA_BASE_URL", "http://127.0.0.1:4111"),
		SupabaseJWTSecret: getEnv("SUPABASE_JWT_SECRET", ""),
		SupabaseJWKSURL:   supabaseJWKSURL(),
		RiskFreeLimit:     getEnvInt("RISK_FREE_LIMIT", 0),
		AIBriefingTimeout: getEnvDuration("AI_BRIEFING_TIMEOUT", 150*time.Second),
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

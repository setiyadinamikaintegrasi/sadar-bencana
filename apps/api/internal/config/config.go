package config

import "os"

// defaultDatabaseURL is the local development PostgreSQL connection string.
// It is constructed from individual parts so the default credentials are
// explicit in source without hard-to-read escaping.
const (
	defaultPgUser = "rrm"
	defaultPgPass = "rrm_dev_2026"
	defaultPgHost = "localhost"
	defaultPgPort = "5433"
	defaultPgDB   = "reinsurance_risk_monitor"
)

// DefaultDatabaseURL constructs the default DATABASE_URL used when the
// DATABASE_URL environment variable is not set.
func DefaultDatabaseURL() string {
	return "postgres://" + defaultPgUser + ":" + defaultPgPass +
		"@" + defaultPgHost + ":" + defaultPgPort + "/" + defaultPgDB
}

type Config struct {
	Host        string
	Port        string
	Env         string
	DatabaseURL string
}

func Load() Config {
	return Config{
		Host:        getEnv("API_HOST", "0.0.0.0"),
		Port:        getEnv("API_PORT", "8001"),
		Env:         getEnv("API_ENV", "local"),
		DatabaseURL: getEnv("DATABASE_URL", DefaultDatabaseURL()),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}
